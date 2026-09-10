import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    GoodsReceiptStatus,
    MasterStatus,
    PurchaseOrderStatus,
    PurchaseOrderType,
    SalesOrderKind,
    WarehousePartyRole,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    CreateGoodsReceiptAutoConfirmDto,
    GoodsReceiptStockCardQueryDto,
    ListGoodsReceiptsQueryDto,
} from './dto/create-goods-receipt.dto'
import { GoodsReceiptPostingService } from 'src/modules/inventory/goods-receipt-posting.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { SalesOrderWorkflowService } from 'src/modules/sales/sales-order-workflow.service'

/** Chứng từ đã sinh ra một bút toán kho, đủ để màn thẻ kho mở ngược về nó. */
type StockCardSource = {
    type:
        | 'GOODS_RECEIPT'
        | 'SALES_DELIVERY'
        | 'WAREHOUSE_TRANSFER'
        | 'STOCK_ADJUSTMENT'
        | 'OWNERSHIP_TRANSFER'
    /** Id để mở màn chi tiết. Với chuyển kho là id LỆNH chuyển, không phải phiếu đi/đến. */
    id: string
    no: string
}

/**
 * Bút toán đảo không treo ở chứng từ nào (nó trỏ về bút toán bị đảo), nên trả null và
 * để màn hình rơi về số hiệu bút toán.
 */
function sourceDocumentOf(posting: {
    goodsReceipt?: { id: string; receiptNo: string } | null
    salesDelivery?: { id: string; deliveryNo: string } | null
    movementDispatch?: { id: string; dispatchNo: string; movementId: string } | null
    movementArrival?: { id: string; arrivalNo: string; movementId: string } | null
    stockAdjustment?: { id: string; adjustmentNo: string } | null
    ownershipTransfer?: { id: string; transferNo: string } | null
}): StockCardSource | null {
    if (posting.goodsReceipt) {
        return {
            type: 'GOODS_RECEIPT',
            id: posting.goodsReceipt.id,
            no: posting.goodsReceipt.receiptNo,
        }
    }
    if (posting.salesDelivery) {
        return {
            type: 'SALES_DELIVERY',
            id: posting.salesDelivery.id,
            no: posting.salesDelivery.deliveryNo,
        }
    }
    if (posting.movementDispatch) {
        return {
            type: 'WAREHOUSE_TRANSFER',
            id: posting.movementDispatch.movementId,
            no: posting.movementDispatch.dispatchNo,
        }
    }
    if (posting.movementArrival) {
        return {
            type: 'WAREHOUSE_TRANSFER',
            id: posting.movementArrival.movementId,
            no: posting.movementArrival.arrivalNo,
        }
    }
    if (posting.stockAdjustment) {
        return {
            type: 'STOCK_ADJUSTMENT',
            id: posting.stockAdjustment.id,
            no: posting.stockAdjustment.adjustmentNo,
        }
    }
    if (posting.ownershipTransfer) {
        return {
            type: 'OWNERSHIP_TRANSFER',
            id: posting.ownershipTransfer.id,
            no: posting.ownershipTransfer.transferNo,
        }
    }
    return null
}

@Injectable()
export class GoodsReceiptsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly receiptPosting: GoodsReceiptPostingService,
        private readonly notificationOutbox: NotificationOutboxService,
        private readonly salesOrderWorkflow: SalesOrderWorkflowService,
    ) {}

    private toDateOrThrow(value: string, code: string) {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) throw new BadRequestException(code)
        return d
    }

    private readonly receiptInclude = Prisma.validator<Prisma.GoodsReceiptInclude>()({
        warehouse: { select: { id: true, code: true, name: true } },
        supplier: { select: { id: true, code: true, name: true } },
        purchaseOrder: { select: { id: true, orderNo: true, orderType: true } },
        posting: { select: { id: true, postingNo: true, status: true, postedAt: true } },
        commercialLotWithdrawalLine: {
            select: {
                withdrawal: { select: { id: true, withdrawalNo: true, withdrawalDate: true } },
            },
        },
        lines: {
            orderBy: { lineNo: 'asc' },
            include: {
                product: { select: { id: true, code: true, name: true, uom: true } },
                owner: { select: { id: true, code: true, name: true } },
                lot: { select: { id: true, lotNo: true } },
            },
        },
    })

    private mapReceipt(receipt: any) {
        const line = receipt.lines?.[0] ?? null
        return {
            ...receipt,
            supplierLocationId: receipt.warehouseId,
            supplierLocation: receipt.warehouse,
            purchaseOrderLineId: line?.purchaseOrderLineId ?? null,
            productId: line?.productId ?? null,
            product: line?.product ?? null,
            qty: line?.actualQty ?? null,
            standardQtyV15: line?.v15Qty ?? null,
            tempC: line?.temperatureC ?? null,
            density: line?.density ?? null,
            totalActualQty: (receipt.lines ?? []).reduce(
                (sum: Prisma.Decimal, item: any) => sum.plus(item.actualQty),
                new Prisma.Decimal(0),
            ),
            totalV15Qty: (receipt.lines ?? []).reduce(
                (sum: Prisma.Decimal, item: any) => sum.plus(item.v15Qty ?? 0),
                new Prisma.Decimal(0),
            ),
            sourceType: receipt.commercialLotWithdrawalLine ? 'COMMERCIAL_LOT_WITHDRAWAL' : 'PURCHASE_RECEIPT',
            sourceNo:
                receipt.commercialLotWithdrawalLine?.withdrawal?.withdrawalNo ??
                receipt.purchaseOrder?.orderNo ??
                null,
        }
    }

    private async assertLocationBelongsToSupplier(args: { supplierCustomerId: string; supplierLocationId: string }) {
        const row = await this.prisma.warehouse.findFirst({
            where: {
                id: args.supplierLocationId,
                status: MasterStatus.ACTIVE,
                parties: {
                    some: {
                        partyId: args.supplierCustomerId,
                        role: WarehousePartyRole.OPERATOR,
                        validTo: null,
                    },
                },
            },
            select: { id: true },
        })
        if (!row) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_INVALID',
                message: 'Kho NCC không hợp lệ hoặc không thuộc NCC đã chọn.',
                supplierLocationId: args.supplierLocationId,
            })
        }
    }

    async list(q: ListGoodsReceiptsQueryDto) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.GoodsReceiptWhereInput = {
            purchaseOrderId: q.purchaseOrderId ?? undefined,
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            warehouseId: q.warehouseId ?? undefined,
            status: q.status ? (q.status as GoodsReceiptStatus) : undefined,
            receiptDate: {
                gte: q.dateFrom ? new Date(q.dateFrom) : undefined,
                lte: q.dateTo ? new Date(`${q.dateTo}T23:59:59.999Z`) : undefined,
            },
            lines: q.productId ? { some: { productId: q.productId } } : undefined,
            ...(q.keyword?.trim()
                ? {
                      OR: [
                          { receiptNo: { contains: q.keyword.trim(), mode: 'insensitive' } },
                          { purchaseOrder: { orderNo: { contains: q.keyword.trim(), mode: 'insensitive' } } },
                          { supplier: { code: { contains: q.keyword.trim(), mode: 'insensitive' } } },
                          { supplier: { name: { contains: q.keyword.trim(), mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.goodsReceipt.findMany({
                where,
                orderBy: { receiptDate: 'desc' },
                skip,
                take: limit,
                include: this.receiptInclude,
            }),
            this.prisma.goodsReceipt.count({ where }),
        ])

        return { items: items.map((item) => this.mapReceipt(item)), total, page, limit }
    }

    async detail(id: string) {
        const receipt = await this.prisma.goodsReceipt.findUnique({
            where: { id },
            include: this.receiptInclude,
        })
        if (!receipt) throw new NotFoundException('GOODS_RECEIPT_NOT_FOUND')
        return this.mapReceipt(receipt)
    }

    async stockCard(q: GoodsReceiptStockCardQueryDto) {
        const dateFrom = q.dateFrom ? new Date(q.dateFrom) : null
        const dateTo = q.dateTo ? new Date(`${q.dateTo}T23:59:59.999Z`) : null
        const dimensions: Prisma.InventoryLedgerEntryWhereInput = {
            warehouseId: q.warehouseId,
            productId: q.productId,
            ownerPartyId: q.ownerPartyId ?? undefined,
        }
        /*
         * Thẻ kho đọc TRỌN sổ cái kho, không loại bút toán nào.
         *
         * Trước đây ở đây có bộ lọc bỏ các bút toán sinh từ rút lô, với lý do "bút toán
         * cũ làm sai tồn kinh doanh". Nhưng nó bỏ các dòng NHẬP mà vẫn giữ các dòng
         * XUẤT, nên số dư chạy xuống âm: kho đang có 1,79 triệu lít mà thẻ kho báo
         * -8.845. Một cuốn sổ dùng để đối chiếu mà báo tồn âm thì vô dụng.
         *
         * Đã đối chiếu trước khi gỡ: tổng sổ cái đầy đủ khớp `InventoryAvailabilityBalance`
         * ở toàn bộ cặp (kho × mặt hàng × chủ hàng), không dòng nào lệch — tức các bút
         * toán rút lô đã được tính đúng một lần, không hề nhân đôi.
         */
        const opening = dateFrom
            ? await this.prisma.inventoryLedgerEntry.aggregate({
                  where: { ...dimensions, effectiveAt: { lt: dateFrom } },
                  _sum: { actualQtyDelta: true, v15QtyDelta: true },
              })
            : null
        const entries = await this.prisma.inventoryLedgerEntry.findMany({
            where: {
                ...dimensions,
                effectiveAt: {
                    gte: dateFrom ?? undefined,
                    lte: dateTo ?? undefined,
                },
            },
            orderBy: [{ effectiveAt: 'asc' }, { id: 'asc' }],
            take: 1000,
            include: {
                warehouse: { select: { id: true, code: true, name: true } },
                product: { select: { id: true, code: true, name: true, uom: true } },
                owner: { select: { id: true, code: true, name: true } },
                lot: { select: { id: true, lotNo: true } },
                posting: {
                    include: {
                        // Mỗi loại bút toán treo ở một chứng từ khác nhau; lấy đủ để dòng
                        // nào trên thẻ kho cũng bấm ngược về được chứng từ sinh ra nó.
                        goodsReceipt: { select: { id: true, receiptNo: true } },
                        salesDelivery: { select: { id: true, deliveryNo: true } },
                        movementDispatch: { select: { id: true, dispatchNo: true, movementId: true } },
                        movementArrival: { select: { id: true, arrivalNo: true, movementId: true } },
                        stockAdjustment: { select: { id: true, adjustmentNo: true } },
                        ownershipTransfer: { select: { id: true, transferNo: true } },
                    },
                },
            },
        })
        let runningActualQty = new Prisma.Decimal(opening?._sum.actualQtyDelta ?? 0)
        let runningV15Qty = new Prisma.Decimal(opening?._sum.v15QtyDelta ?? 0)
        const items = entries.map((entry) => {
            runningActualQty = runningActualQty.plus(entry.actualQtyDelta)
            runningV15Qty = runningV15Qty.plus(entry.v15QtyDelta ?? 0)
            const source = sourceDocumentOf(entry.posting)
            return {
                ...entry,
                documentNo: source?.no ?? entry.posting.postingNo,
                goodsReceiptId: entry.posting.goodsReceipt?.id ?? null,
                source,
                runningActualQty,
                runningV15Qty,
            }
        })
        return {
            openingActualQty: opening?._sum.actualQtyDelta ?? new Prisma.Decimal(0),
            openingV15Qty: opening?._sum.v15QtyDelta ?? new Prisma.Decimal(0),
            endingActualQty: runningActualQty,
            endingV15Qty: runningV15Qty,
            items,
            truncated: entries.length === 1000,
        }
    }

    /**
     * Purchasing raises a receipt request. Stock is only affected once the warehouse
     * confirms it, so the receipt stays in DRAFT until then.
     */
    async createRequest(dto: CreateGoodsReceiptAutoConfirmDto, actorId?: string | null) {
        const receiptNo = (dto.receiptNo ?? '').trim()
        if (!receiptNo) throw new BadRequestException('RECEIPT_NO_REQUIRED')

        const receiptDate = this.toDateOrThrow(dto.receiptDate, 'RECEIPT_DATE_INVALID')
        const qty = Number(dto.qty) || 0
        if (qty <= 0) throw new BadRequestException('QTY_INVALID')

        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id: dto.purchaseOrderId },
            include: { lines: true },
        })

        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        if (po.orderType === PurchaseOrderType.LOT) {
            throw new BadRequestException({
                code: 'LOT_MUST_USE_WITHDRAWAL_FLOW',
                message: 'Đơn mua lô phải nhận hàng qua phiếu rút lô.',
            })
        }
        if (po.status !== PurchaseOrderStatus.APPROVED && po.status !== PurchaseOrderStatus.IN_PROGRESS) {
            throw new BadRequestException('PO_NOT_APPROVED')
        }

        const line = po.lines.find((x) => x.id === dto.purchaseOrderLineId)
        if (!line) throw new BadRequestException('PO_LINE_NOT_FOUND')

        const resolvedLocId = dto.supplierLocationId ?? line.receivingWarehouseId
        if (!resolvedLocId) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_REQUIRED',
                message: 'Phiếu nhận hàng phải có kho nhận (từ dòng hàng / hoặc kho mặc định ở đầu PO).',
            })
        }

        await this.assertLocationBelongsToSupplier({
            supplierCustomerId: po.supplierCustomerId,
            supplierLocationId: resolvedLocId,
        })

        const warehouse = await this.prisma.warehouse.findUniqueOrThrow({
            where: { id: resolvedLocId },
            select: { code: true, name: true, legalEntity: { select: { partyId: true } } },
        })

        const result = await this.prisma.$transaction(async (tx) => {
            const receipt = await tx.goodsReceipt.create({
                data: {
                    supplierCustomerId: po.supplierCustomerId,
                    warehouseId: resolvedLocId,
                    receiptNo,
                    receiptDate,

                    vehicleId: dto.vehicleId ?? null,
                    driverId: dto.driverId ?? null,
                    shippingFee: dto.shippingFee == null ? new Prisma.Decimal(0) : new Prisma.Decimal(dto.shippingFee),

                    status: GoodsReceiptStatus.DRAFT,

                    purchaseOrderId: po.id,
                },
            })

            await tx.goodsReceiptLine.create({
                data: {
                    goodsReceiptId: receipt.id,
                    lineNo: 1,
                    purchaseOrderLineId: line.id,
                    productId: line.productId,
                    ownerPartyId: warehouse.legalEntity.partyId,
                    actualQty: new Prisma.Decimal(qty),
                    v15Qty: dto.standardQtyV15 == null ? null : new Prisma.Decimal(dto.standardQtyV15),
                    temperatureC: dto.tempC == null ? null : new Prisma.Decimal(dto.tempC),
                    density: dto.density == null ? null : new Prisma.Decimal(dto.density),
                },
            })

            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.RECEIPT_REQUESTED,
                    aggregateType: 'PURCHASE_RECEIPT',
                    aggregateId: receipt.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.RECEIPT_REQUESTED}:${receipt.id}`,
                    payload: {
                        entityType: 'PURCHASE_RECEIPT',
                        entityId: receipt.id,
                        workItemSourceType: 'PURCHASE_RECEIPT',
                        workItemSourceId: receipt.id,
                        orderNo: po.orderNo,
                        receiptNo,
                        warehouseCode: warehouse.code || warehouse.name,
                        actionRequired: true,
                        recipientPermissionCodes: ['operations.warehouse.manage'],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )

            return tx.goodsReceipt.findUniqueOrThrow({
                where: { id: receipt.id },
                include: this.receiptInclude,
            })
        })

        return { receipt: this.mapReceipt(result) }
    }

    /** Warehouse accepts the goods: this is the step that actually moves stock. */
    async confirm(id: string, actorId?: string | null) {
        const result = await this.prisma.$transaction(async (tx) => {
            const receipt = await tx.goodsReceipt.findFirst({
                where: { id, status: GoodsReceiptStatus.DRAFT },
                include: {
                    lines: { orderBy: { lineNo: 'asc' } },
                    warehouse: { select: { code: true, name: true } },
                    purchaseOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            status: true,
                            createdById: true,
                            supplierCustomerId: true,
                            releaseCode: true,
                            salesOrderId: true,
                            salesOrder: { select: { kind: true, approvedAt: true } },
                        },
                    },
                },
            })
            if (!receipt) throw new BadRequestException('GOODS_RECEIPT_NOT_DRAFT')
            const line = receipt.lines[0]
            if (!line) throw new BadRequestException('GOODS_RECEIPT_LINE_REQUIRED')
            const isApprovedDayTradeReceipt = Boolean(
                receipt.purchaseOrder?.salesOrderId &&
                    receipt.purchaseOrder.salesOrder?.kind === SalesOrderKind.DAY_TRADE &&
                    receipt.purchaseOrder.salesOrder.approvedAt,
            )

            await this.receiptPosting.postSingleLineReceipt({
                tx,
                goodsReceiptId: receipt.id,
                warehouseId: receipt.warehouseId,
                productId: line.productId,
                purchaseOrderLineId: line.purchaseOrderLineId,
                actualQty: line.actualQty,
                v15Qty: line.v15Qty,
                temperatureC: line.temperatureC,
                density: line.density,
                effectiveAt: receipt.receiptDate,
                actorId,
                ownerPartyId: line.ownerPartyId,
                supplierPartyId: receipt.purchaseOrder?.supplierCustomerId,
                releaseCode: receipt.purchaseOrder?.releaseCode,
                // Đơn đối ứng được phép giao hàng trước khi NCC xuất hóa đơn. Hàng vừa
                // nhập sẽ được giữ cho chính đơn bán liên kết ở bước reserveAndDispatch,
                // không bị treo thêm ở trạng thái chờ hóa đơn NCC.
                awaitingSupplierInvoice: !isApprovedDayTradeReceipt,
            })

            await tx.goodsReceipt.update({
                where: { id: receipt.id },
                data: { status: GoodsReceiptStatus.CONFIRMED },
            })

            if (receipt.purchaseOrder?.status === PurchaseOrderStatus.APPROVED) {
                await tx.purchaseOrder.update({
                    where: { id: receipt.purchaseOrder.id },
                    data: { status: PurchaseOrderStatus.IN_PROGRESS },
                })
            }

            if (isApprovedDayTradeReceipt && receipt.purchaseOrder?.salesOrderId) {
                // Hàng mua đối ứng vừa về kho: thử giữ đúng lượng đã có và tự sinh
                // công việc xuất kho khi toàn bộ đơn bán đã đủ hàng.
                await this.salesOrderWorkflow.reserveAndDispatch(
                    tx,
                    receipt.purchaseOrder.salesOrderId,
                    { userId: actorId ?? null },
                )
            }

            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.RECEIPT_CONFIRMED,
                    aggregateType: 'PURCHASE_RECEIPT',
                    aggregateId: receipt.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.RECEIPT_CONFIRMED}:${receipt.id}`,
                    payload: {
                        entityType: 'COMMERCIAL_PURCHASE_RETAIL',
                        entityId: receipt.purchaseOrder?.id ?? receipt.id,
                        workItemSourceType: 'PURCHASE_RECEIPT',
                        workItemSourceId: receipt.id,
                        orderNo: receipt.purchaseOrder?.orderNo ?? '',
                        receiptNo: receipt.receiptNo,
                        warehouseCode: receipt.warehouse.code || receipt.warehouse.name,
                        resolvedActions: ['CONFIRM_PURCHASE_RECEIPT'],
                        recipientUserIds: receipt.purchaseOrder?.createdById
                            ? [receipt.purchaseOrder.createdById]
                            : [],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )

            return tx.goodsReceipt.findUniqueOrThrow({
                where: { id: receipt.id },
                include: this.receiptInclude,
            })
        })

        return { receipt: this.mapReceipt(result) }
    }

    /** Warehouse rejects, or purchasing withdraws, a request that has not been posted. */
    async voidRequest(id: string, actorId?: string | null) {
        const result = await this.prisma.$transaction(async (tx) => {
            const receipt = await tx.goodsReceipt.findFirst({
                where: { id, status: GoodsReceiptStatus.DRAFT },
                include: {
                    purchaseOrder: { select: { id: true, orderNo: true, createdById: true } },
                },
            })
            if (!receipt) throw new BadRequestException('GOODS_RECEIPT_NOT_DRAFT')

            await tx.goodsReceipt.update({
                where: { id: receipt.id },
                data: { status: GoodsReceiptStatus.VOID },
            })

            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.RECEIPT_REJECTED,
                    aggregateType: 'PURCHASE_RECEIPT',
                    aggregateId: receipt.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.RECEIPT_REJECTED}:${receipt.id}`,
                    payload: {
                        entityType: 'COMMERCIAL_PURCHASE_RETAIL',
                        entityId: receipt.purchaseOrder?.id ?? receipt.id,
                        workItemSourceType: 'PURCHASE_RECEIPT',
                        workItemSourceId: receipt.id,
                        orderNo: receipt.purchaseOrder?.orderNo ?? '',
                        receiptNo: receipt.receiptNo,
                        resolvedActions: ['CONFIRM_PURCHASE_RECEIPT'],
                        recipientUserIds: receipt.purchaseOrder?.createdById
                            ? [receipt.purchaseOrder.createdById]
                            : [],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )

            return tx.goodsReceipt.findUniqueOrThrow({
                where: { id: receipt.id },
                include: this.receiptInclude,
            })
        })

        return { receipt: this.mapReceipt(result) }
    }
}
