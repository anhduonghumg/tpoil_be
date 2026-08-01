import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    GoodsReceiptStatus,
    MasterStatus,
    PurchaseOrderStatus,
    PurchaseOrderType,
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

@Injectable()
export class GoodsReceiptsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly receiptPosting: GoodsReceiptPostingService,
        private readonly notificationOutbox: NotificationOutboxService,
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
        // Rút lô chỉ là nghiệp vụ theo dõi hàng đã nhận từ kho thuê. Các bút toán
        // cũ từng phát sinh từ rút lô được loại khỏi thẻ kho để không làm sai tồn kinh doanh.
        const excludeCommercialLotWithdrawal: Prisma.InventoryLedgerEntryWhereInput = {
            NOT: [
                {
                    posting: {
                        goodsReceipt: {
                            is: { commercialLotWithdrawalLine: { isNot: null } },
                        },
                    },
                },
                {
                    posting: {
                        reversalOf: {
                            is: {
                                goodsReceipt: {
                                    is: { commercialLotWithdrawalLine: { isNot: null } },
                                },
                            },
                        },
                    },
                },
            ],
        }
        const opening = dateFrom
            ? await this.prisma.inventoryLedgerEntry.aggregate({
                  where: { ...dimensions, ...excludeCommercialLotWithdrawal, effectiveAt: { lt: dateFrom } },
                  _sum: { actualQtyDelta: true, v15QtyDelta: true },
              })
            : null
        const entries = await this.prisma.inventoryLedgerEntry.findMany({
            where: {
                ...dimensions,
                ...excludeCommercialLotWithdrawal,
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
                        goodsReceipt: { select: { id: true, receiptNo: true } },
                    },
                },
            },
        })
        let runningActualQty = new Prisma.Decimal(opening?._sum.actualQtyDelta ?? 0)
        let runningV15Qty = new Prisma.Decimal(opening?._sum.v15QtyDelta ?? 0)
        const items = entries.map((entry) => {
            runningActualQty = runningActualQty.plus(entry.actualQtyDelta)
            runningV15Qty = runningV15Qty.plus(entry.v15QtyDelta ?? 0)
            return {
                ...entry,
                documentNo: entry.posting.goodsReceipt?.receiptNo ?? entry.posting.postingNo,
                goodsReceiptId: entry.posting.goodsReceipt?.id ?? null,
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
                    purchaseOrder: { select: { id: true, orderNo: true, status: true, createdById: true } },
                },
            })
            if (!receipt) throw new BadRequestException('GOODS_RECEIPT_NOT_DRAFT')
            const line = receipt.lines[0]
            if (!line) throw new BadRequestException('GOODS_RECEIPT_LINE_REQUIRED')

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
