import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CommercialLotWithdrawalStatus,
  GoodsReceiptStatus,
  MasterStatus,
  PayableOpenItemStatus,
  Prisma,
  PurchaseOrderStatus,
  PurchaseOrderType,
  SupplierInvoiceStatus,
} from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import {
  CreateCommercialLotWithdrawalDto,
  ListCommercialLotsQueryDto,
  ListLotWithdrawalsQueryDto,
} from './dto/commercial-lot.dto';
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service';
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events';
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service';

const detailInclude = Prisma.validator<Prisma.PurchaseOrderInclude>()({
  supplier: { select: { id: true, code: true, name: true, taxCode: true, bankAccountNo: true } },
  contract: { select: { id: true, code: true, name: true, startDate: true, endDate: true } },
  lines: {
    orderBy: { lineNo: 'asc' },
    include: {
      product: { select: { id: true, code: true, name: true, uom: true } },
      receivingWarehouse: { select: { id: true, code: true, name: true } },
      plannedReceivingArea: { select: { id: true, code: true, name: true } },
      commercialLotPosition: true,
    },
  },
  supplierInvoices: {
    where: { status: { not: SupplierInvoiceStatus.VOIDED } },
    orderBy: { invoiceDate: 'asc' },
    include: {
      openItem: true,
      lines: {
        select: {
          id: true,
          purchaseOrderLineId: true,
          actualQty: true,
          netAmount: true,
          taxAmount: true,
        },
      },
    },
  },
  termPaymentRequests: {
    orderBy: { createdAt: 'desc' },
    include: {
      supplierInvoice: { select: { id: true, invoiceNo: true, invoiceDate: true } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: {
          sourceBankAccount: {
            select: { id: true, bankCode: true, bankName: true, accountNo: true },
          },
        },
      },
    },
  },
  commercialLotWithdrawals: {
    orderBy: [{ withdrawalDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      destinationWarehouse: { select: { id: true, code: true, name: true } },
      lines: {
        orderBy: { lineNo: 'asc' },
        include: {
          destinationWarehouse: { select: { id: true, code: true, name: true } },
          commercialLotPosition: {
            include: {
              product: { select: { id: true, code: true, name: true, uom: true } },
            },
          },
        },
      },
    },
  },
});

@Injectable()
export class CommercialLotsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationOutbox: NotificationOutboxService,
    private readonly receiptPosting: GoodsReceiptPostingService,
  ) {}

  private quantityTotals(order: any) {
    const orderedQty = (order.lines ?? []).reduce(
      (sum: number, line: any) => sum + Number(line.orderedQty ?? 0),
      0,
    );
    const invoicedQty = (order.lines ?? []).reduce(
      (sum: number, line: any) => sum + Number(line.commercialLotPosition?.invoicedQty ?? 0),
      0,
    );
    const withdrawnQty = (order.lines ?? []).reduce(
      (sum: number, line: any) => sum + Number(line.commercialLotPosition?.withdrawnQty ?? 0),
      0,
    );
    const accountingValue = (order.lines ?? []).reduce(
      (sum: number, line: any) => sum + Number(line.commercialLotPosition?.accountingValue ?? 0),
      0,
    );
    return {
      orderedQty,
      invoicedQty,
      withdrawnQty,
      remainingToWithdraw: Math.max(invoicedQty - withdrawnQty, 0),
      accountingValue,
    };
  }

  private paymentTotals(order: any) {
    const postedInvoices = (order.supplierInvoices ?? []).filter(
      (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
    );
    const payableAmount = postedInvoices.reduce(
      (sum: number, invoice: any) =>
        sum + Number(invoice.openItem?.originalAmount ?? invoice.totalAmount ?? 0),
      0,
    );
    const outstandingAmount = postedInvoices.reduce(
      (sum: number, invoice: any) =>
        sum + Number(invoice.openItem?.outstandingAmount ?? invoice.totalAmount ?? 0),
      0,
    );
    return {
      payableAmount,
      paidAmount: Math.max(payableAmount - outstandingAmount, 0),
      outstandingAmount,
      isPaid:
        postedInvoices.length > 0 &&
        postedInvoices.every(
          (invoice: any) => invoice.openItem?.status === PayableOpenItemStatus.SETTLED,
        ),
    };
  }

  private lifecycle(order: any) {
    if (order.status === PurchaseOrderStatus.CANCELLED) return 'CANCELLED';
    if (order.status === PurchaseOrderStatus.DRAFT) return 'PENDING_APPROVAL';

    const postedInvoices = (order.supplierInvoices ?? []).filter(
      (invoice: any) => invoice.status === SupplierInvoiceStatus.POSTED,
    );
    if (!postedInvoices.length) return 'PENDING_INVOICE';
    const payment = this.paymentTotals(order);
    if (!payment.isPaid) return 'PENDING_PAYMENT';

    const totals = this.quantityTotals(order);
    if (totals.remainingToWithdraw <= 0 && totals.invoicedQty >= totals.orderedQty)
      return 'COMPLETED';
    if (totals.withdrawnQty > 0) return 'WITHDRAWING';
    return 'READY_TO_WITHDRAW';
  }

  private mapOrder(order: any) {
    return {
      ...order,
      lifecycle: this.lifecycle(order),
      quantities: this.quantityTotals(order),
      payment: this.paymentTotals(order),
    };
  }

  async list(query: ListCommercialLotsQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const where: Prisma.PurchaseOrderWhereInput = {
      orderType: PurchaseOrderType.LOT,
      bizType: 'COMMERCIAL',
      supplierCustomerId: query.supplierCustomerId ?? undefined,
      orderDate: {
        gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
        lte: query.dateTo ? new Date(`${query.dateTo}T23:59:59.999Z`) : undefined,
      },
      ...(query.keyword?.trim()
        ? {
            OR: [
              { orderNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
              {
                supplier: {
                  name: { contains: query.keyword.trim(), mode: 'insensitive' },
                },
              },
            ],
          }
        : {}),
    };
    if (query.lifecycle) {
      const rows = await this.prisma.purchaseOrder.findMany({
        where,
        include: detailInclude,
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        take: 1000,
      });
      const matching = rows
        .map((row) => this.mapOrder(row))
        .filter((item) => item.lifecycle === query.lifecycle);
      return {
        items: matching.slice((page - 1) * limit, page * limit),
        total: matching.length,
        page,
        limit,
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({
        where,
        include: detailInclude,
        orderBy: [{ orderDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return { items: rows.map((row) => this.mapOrder(row)), total, page, limit };
  }

  async detail(id: string) {
    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id, orderType: PurchaseOrderType.LOT, bizType: 'COMMERCIAL' },
      include: detailInclude,
    });
    if (!order) throw new NotFoundException('COMMERCIAL_LOT_PURCHASE_NOT_FOUND');
    return this.mapOrder(order);
  }

  async listWithdrawals(query: ListLotWithdrawalsQueryDto) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const status = query.status ?? CommercialLotWithdrawalStatus.DRAFT;
    const keyword = query.keyword?.trim();
    const where: Prisma.CommercialLotWithdrawalWhereInput = {
      status,
      purchaseOrder: { orderType: PurchaseOrderType.LOT, bizType: 'COMMERCIAL' },
      ...(keyword
        ? {
            OR: [
              { withdrawalNo: { contains: keyword, mode: 'insensitive' } },
              { purchaseOrder: { orderNo: { contains: keyword, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.commercialLotWithdrawal.findMany({
        where,
        orderBy: [{ withdrawalDate: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          purchaseOrder: {
            select: {
              id: true,
              orderNo: true,
              supplier: { select: { code: true, name: true } },
            },
          },
          destinationWarehouse: { select: { id: true, code: true, name: true } },
          lines: {
            orderBy: { lineNo: 'asc' },
            include: {
              destinationWarehouse: { select: { id: true, code: true, name: true } },
              commercialLotPosition: {
                include: {
                  product: { select: { id: true, code: true, name: true, uom: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.commercialLotWithdrawal.count({ where }),
    ]);
    return { items: rows, total, page, limit };
  }

  async createWithdrawal(
    purchaseOrderId: string,
    dto: CreateCommercialLotWithdrawalDto,
    actorId?: string | null,
  ) {
    const withdrawalNo = dto.withdrawalNo.trim();
    if (!withdrawalNo) throw new BadRequestException('WITHDRAWAL_NO_REQUIRED');
    if (new Set(dto.lines.map((line) => line.commercialLotPositionId)).size !== dto.lines.length) {
      throw new BadRequestException('WITHDRAWAL_POSITION_DUPLICATED');
    }

    const id = await this.prisma.$transaction(async (tx) => {
      const order = await tx.purchaseOrder.findFirst({
        where: {
          id: purchaseOrderId,
          orderType: PurchaseOrderType.LOT,
          bizType: 'COMMERCIAL',
          status: { in: [PurchaseOrderStatus.APPROVED, PurchaseOrderStatus.IN_PROGRESS] },
        },
        include: {
          supplierInvoices: {
            where: { status: SupplierInvoiceStatus.POSTED },
            include: { openItem: true },
          },
        },
      });
      if (!order) throw new BadRequestException('COMMERCIAL_LOT_PURCHASE_NOT_WITHDRAWABLE');
      if (!order.supplierInvoices.length)
        throw new BadRequestException('POSTED_SUPPLIER_INVOICE_REQUIRED');
      if (
        order.supplierInvoices.some(
          (invoice) => invoice.openItem?.status !== PayableOpenItemStatus.SETTLED,
        )
      ) {
        throw new BadRequestException({
          code: 'LOT_PAYMENT_REQUIRED_BEFORE_WITHDRAWAL',
          message: 'Đơn lô phải hoàn tất thanh toán trước khi xác nhận rút hàng.',
        });
      }

      const destinationWarehouseIds = Array.from(
        new Set(dto.lines.map((line) => line.destinationWarehouseId ?? dto.destinationWarehouseId)),
      );
      if (destinationWarehouseIds.some((warehouseId) => !warehouseId)) {
        throw new BadRequestException('DESTINATION_WAREHOUSE_REQUIRED_PER_LINE');
      }
      const warehouses = await tx.warehouse.findMany({
        where: {
          id: { in: destinationWarehouseIds as string[] },
          legalEntityId: order.legalEntityId,
          status: MasterStatus.ACTIVE,
        },
        select: { id: true, areaId: true },
      });
      if (warehouses.length !== destinationWarehouseIds.length) {
        throw new BadRequestException('DESTINATION_WAREHOUSE_INVALID');
      }
      const warehouseMap = new Map(warehouses.map((warehouse) => [warehouse.id, warehouse]));

      const positionIds = dto.lines.map((line) => line.commercialLotPositionId);
      const positions = await tx.commercialLotPosition.findMany({
        where: {
          id: { in: positionIds },
          purchaseOrderLine: { purchaseOrderId: order.id },
        },
        select: {
          id: true,
          invoicedQty: true,
          withdrawnQty: true,
          plannedWarehouseId: true,
          plannedWarehouseAreaId: true,
        },
      });
      if (positions.length !== positionIds.length) {
        throw new BadRequestException('WITHDRAWAL_POSITION_INVALID');
      }
      const positionMap = new Map(positions.map((position) => [position.id, position]));
      const activeDrafts = await tx.commercialLotWithdrawalLine.groupBy({
        by: ['commercialLotPositionId'],
        where: {
          commercialLotPositionId: { in: positionIds },
          withdrawal: {
            purchaseOrderId: order.id,
            status: CommercialLotWithdrawalStatus.DRAFT,
          },
        },
        _sum: { actualQty: true },
      });
      const draftQtyMap = new Map(
        activeDrafts.map((row) => [
          row.commercialLotPositionId,
          row._sum.actualQty ?? new Prisma.Decimal(0),
        ]),
      );
      for (const line of dto.lines) {
        const position = positionMap.get(line.commercialLotPositionId)!;
        const warehouseId = line.destinationWarehouseId ?? dto.destinationWarehouseId;
        const warehouse = warehouseMap.get(warehouseId!)!;
        if (position.plannedWarehouseId && position.plannedWarehouseId !== warehouse.id) {
          throw new BadRequestException({
            code: 'DESTINATION_WAREHOUSE_DIFFERS_FROM_PLANNED_WAREHOUSE',
            message: 'Kho rút phải đúng kho nhận đích danh đã chọn trên đơn mua.',
          });
        }
        if (
          position.plannedWarehouseAreaId &&
          position.plannedWarehouseAreaId !== warehouse.areaId
        ) {
          throw new BadRequestException({
            code: 'DESTINATION_WAREHOUSE_OUTSIDE_PLANNED_AREA',
            message: 'Kho rút phải thuộc khu vực kho nhận đã chọn trên đơn mua.',
          });
        }
        const available = position.invoicedQty
          .minus(position.withdrawnQty)
          .minus(draftQtyMap.get(position.id) ?? 0);
        if (new Prisma.Decimal(line.actualQty).greaterThan(available)) {
          throw new BadRequestException({
            code: 'WITHDRAWAL_QTY_EXCEEDS_INVOICED_BALANCE',
            message: 'Số lượng rút vượt quá lượng hóa đơn còn lại.',
            commercialLotPositionId: position.id,
            availableQty: available.toString(),
          });
        }
      }

      const withdrawal = await tx.commercialLotWithdrawal.create({
        data: {
          purchaseOrderId: order.id,
          withdrawalNo,
          // Giữ lại kho cấp phiếu cho dữ liệu cũ; kho thực tế là theo từng dòng bên dưới.
          destinationWarehouseId: destinationWarehouseIds[0]!,
          withdrawalDate: new Date(dto.withdrawalDate),
          note: dto.note?.trim() || null,
          createdById: actorId ?? null,
          lines: {
            create: dto.lines.map((line, index) => ({
              lineNo: index + 1,
              commercialLotPositionId: line.commercialLotPositionId,
              destinationWarehouseId: (line.destinationWarehouseId ?? dto.destinationWarehouseId)!,
              actualQty: new Prisma.Decimal(line.actualQty),
              v15Qty: line.v15Qty == null ? null : new Prisma.Decimal(line.v15Qty),
              temperatureC:
                line.temperatureC == null ? null : new Prisma.Decimal(line.temperatureC),
              density: line.density == null ? null : new Prisma.Decimal(line.density),
            })),
          },
        },
        select: { id: true },
      });
      return withdrawal.id;
    });
    return this.detailWithdrawal(id);
  }

  private async detailWithdrawal(id: string) {
    const withdrawal = await this.prisma.commercialLotWithdrawal.findUnique({
      where: { id },
      include: {
        destinationWarehouse: { select: { id: true, code: true, name: true } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: {
            destinationWarehouse: { select: { id: true, code: true, name: true } },
            commercialLotPosition: {
              include: {
                product: {
                  select: { id: true, code: true, name: true, uom: true },
                },
              },
            },
          },
        },
      },
    });
    if (!withdrawal) throw new NotFoundException('LOT_WITHDRAWAL_NOT_FOUND');
    return withdrawal;
  }

  async confirmWithdrawal(purchaseOrderId: string, withdrawalId: string, actorId?: string | null) {
    await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.commercialLotWithdrawal.findFirst({
        where: {
          id: withdrawalId,
          purchaseOrderId,
          status: CommercialLotWithdrawalStatus.DRAFT,
        },
        include: {
          purchaseOrder: { select: { orderNo: true, releaseCode: true, createdById: true } },
          lines: {
            include: {
              destinationWarehouse: { select: { code: true, name: true } },
              commercialLotPosition: true,
            },
          },
        },
      });
      if (!withdrawal) throw new BadRequestException('LOT_WITHDRAWAL_NOT_DRAFT');
      const now = new Date();

      for (const line of withdrawal.lines) {
        const position = line.commercialLotPosition;
        const destinationWarehouseId = line.destinationWarehouseId;
        const available = position.invoicedQty.minus(position.withdrawnQty);
        if (line.actualQty.greaterThan(available)) {
          throw new BadRequestException('WITHDRAWAL_QTY_EXCEEDS_INVOICED_BALANCE');
        }
        const receiptNo = `${withdrawal.purchaseOrder.orderNo}-${withdrawal.withdrawalNo}-${line.lineNo}`;
        const receipt = await tx.goodsReceipt.create({
          data: {
            receiptNo,
            supplierCustomerId: position.supplierCustomerId,
            warehouseId: destinationWarehouseId,
            receiptDate: withdrawal.withdrawalDate,
            status: GoodsReceiptStatus.CONFIRMED,
            purchaseOrderId: withdrawal.purchaseOrderId,
            note: `Rút lô ${withdrawal.withdrawalNo}`,
          },
        });
        // Rút lô là nhập kho thật: phải có lô kho mang mã NCC và mã rút TP/NCC thì
        // bán hàng mới thấy tồn và chọn được mã NCC khi duyệt đơn. Chủ hàng để mặc
        // định theo pháp nhân của kho đích — đúng chủ hàng mà FIFO bán hàng tra cứu.
        await this.receiptPosting.postSingleLineReceipt({
          tx,
          goodsReceiptId: receipt.id,
          warehouseId: destinationWarehouseId,
          productId: position.productId,
          purchaseOrderLineId: position.purchaseOrderLineId,
          actualQty: line.actualQty,
          v15Qty: line.v15Qty,
          temperatureC: line.temperatureC,
          density: line.density,
          effectiveAt: withdrawal.withdrawalDate,
          actorId,
          supplierPartyId: position.supplierCustomerId,
          releaseCode: position.releaseCode ?? withdrawal.purchaseOrder.releaseCode,
          // Chỉ phần đã có hóa đơn mới được rút nên không giữ chờ hóa đơn nữa.
          awaitingSupplierInvoice: false,
        });
        await tx.commercialLotWithdrawalLine.update({
          where: { id: line.id },
          data: { goodsReceiptId: receipt.id },
        });
        await tx.commercialLotPosition.update({
          where: { id: position.id },
          data: {
            withdrawnQty: { increment: line.actualQty },
            version: { increment: 1 },
          },
        });
      }

      await tx.commercialLotWithdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: CommercialLotWithdrawalStatus.CONFIRMED,
          confirmedById: actorId ?? null,
          confirmedAt: now,
          version: { increment: 1 },
        },
      });

      const positions = await tx.commercialLotPosition.findMany({
        where: { purchaseOrderLine: { purchaseOrderId } },
        include: { purchaseOrderLine: { select: { orderedQty: true } } },
      });
      const completed =
        positions.length > 0 &&
        positions.every(
          (position) =>
            position.invoicedQty.greaterThanOrEqualTo(position.purchaseOrderLine.orderedQty) &&
            position.withdrawnQty.greaterThanOrEqualTo(position.invoicedQty),
        );
      await tx.purchaseOrder.update({
        where: { id: purchaseOrderId },
        data: {
          status: completed ? PurchaseOrderStatus.COMPLETED : PurchaseOrderStatus.IN_PROGRESS,
          version: { increment: 1 },
        },
      });
      await this.notificationOutbox.emit(
        {
          eventType: PURCHASE_NOTIFICATION_EVENTS.WITHDRAWAL_CONFIRMED,
          aggregateType: 'COMMERCIAL_PURCHASE_WITHDRAWAL',
          aggregateId: withdrawal.id,
          dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.WITHDRAWAL_CONFIRMED}:${withdrawal.id}`,
          payload: {
            entityType: 'COMMERCIAL_PURCHASE',
            entityId: purchaseOrderId,
            orderNo: withdrawal.purchaseOrder.orderNo,
            withdrawalNo: withdrawal.withdrawalNo,
            warehouseCode: Array.from(
              new Set(
                withdrawal.lines.map((line) => {
                  const warehouse = line.destinationWarehouse;
                  return warehouse.code || warehouse.name;
                }),
              ),
            ).join(', '),
            recipientUserIds: withdrawal.purchaseOrder.createdById
              ? [withdrawal.purchaseOrder.createdById]
              : [],
            excludeUserIds: actorId ? [actorId] : [],
          },
        },
        tx,
      );
    });
    return this.detail(purchaseOrderId);
  }

  async cancelWithdrawal(purchaseOrderId: string, withdrawalId: string, actorId?: string | null) {
    const result = await this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.commercialLotWithdrawal.findFirst({
        where: {
          id: withdrawalId,
          purchaseOrderId,
          status: CommercialLotWithdrawalStatus.DRAFT,
        },
        include: { purchaseOrder: { select: { orderNo: true, createdById: true } } },
      });
      if (!withdrawal) return { count: 0 };
      const updated = await tx.commercialLotWithdrawal.updateMany({
        where: { id: withdrawal.id, status: CommercialLotWithdrawalStatus.DRAFT },
        data: {
          status: CommercialLotWithdrawalStatus.CANCELLED,
          version: { increment: 1 },
        },
      });
      if (updated.count) {
        await this.notificationOutbox.emit(
          {
            eventType: PURCHASE_NOTIFICATION_EVENTS.WITHDRAWAL_CANCELLED,
            aggregateType: 'COMMERCIAL_PURCHASE_WITHDRAWAL',
            aggregateId: withdrawal.id,
            dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.WITHDRAWAL_CANCELLED}:${withdrawal.id}`,
            payload: {
              entityType: 'COMMERCIAL_PURCHASE',
              entityId: purchaseOrderId,
              orderNo: withdrawal.purchaseOrder.orderNo,
              withdrawalNo: withdrawal.withdrawalNo,
              recipientUserIds: withdrawal.purchaseOrder.createdById
                ? [withdrawal.purchaseOrder.createdById]
                : [],
              excludeUserIds: actorId ? [actorId] : [],
            },
          },
          tx,
        );
      }
      return updated;
    });
    if (result.count !== 1) throw new BadRequestException('LOT_WITHDRAWAL_NOT_DRAFT');
    return this.detail(purchaseOrderId);
  }
}
