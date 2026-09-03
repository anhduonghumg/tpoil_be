import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    AccountingInventoryPostingKind,
    Prisma,
    ReservationStatus,
    SalesOrderSupplySource,
} from '@prisma/client'

type AccountingEntryInput = {
    sourceLineId: string | null
    legalEntityId: string
    warehouseId: string | null
    warehouseAreaId: string | null
    productId: string
    supplierPartyId: string
    releaseCode: SalesOrderSupplySource
    qtyDelta: Prisma.Decimal
    valueDelta: Prisma.Decimal
}

/**
 * Append-only ledger for accounting stock.
 *
 * Physical stock continues to be owned by InventoryPosting/StockBalance. This service only
 * reacts to invoices, so issuing an invoice before a truck leaves never changes physical
 * availability or consumes the warehouse reservation.
 */
@Injectable()
export class AccountingInventoryService {
    private locationError(sourceLineId: string) {
        return new BadRequestException({
            code: 'ACCOUNTING_INVENTORY_LOCATION_REQUIRED',
            message: 'Dòng hàng phải có kho hoặc khu vực nhận trước khi ghi nhận tồn kế toán.',
            sourceLineId,
        })
    }

    private sourceError(sourceLineId: string) {
        return new BadRequestException({
            code: 'ACCOUNTING_INVENTORY_SOURCE_REQUIRED',
            message: 'Dòng hàng chưa xác định đủ mã TP/NCC và nhà cung cấp để ghi nhận tồn kế toán.',
            sourceLineId,
        })
    }

    async postPurchaseInvoice(
        tx: Prisma.TransactionClient,
        args: { supplierInvoiceId: string; actorId?: string | null },
    ) {
        const idempotencyKey = `accounting-inventory:purchase-invoice:${args.supplierInvoiceId}`
        const existing = await tx.accountingInventoryPosting.findUnique({ where: { idempotencyKey } })
        if (existing) return existing

        const invoice = await tx.supplierInvoice.findUnique({
            where: { id: args.supplierInvoiceId },
            include: {
                purchaseOrder: { select: { releaseCode: true } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        purchaseOrderLine: {
                            select: { receivingWarehouseId: true, plannedReceivingAreaId: true },
                        },
                        receiptLine: {
                            select: {
                                goodsReceipt: { select: { warehouseId: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!invoice) throw new NotFoundException('SUPPLIER_INVOICE_NOT_FOUND')

        const entries: AccountingEntryInput[] = []
        for (const line of invoice.lines) {
            if (!line.productId || !line.actualQty || line.actualQty.isZero()) continue
            const warehouseId =
                line.receiptLine?.goodsReceipt.warehouseId ??
                line.purchaseOrderLine?.receivingWarehouseId ??
                null
            const warehouseAreaId = warehouseId
                ? null
                : (line.purchaseOrderLine?.plannedReceivingAreaId ?? null)
            if (!warehouseId && !warehouseAreaId) throw this.locationError(line.id)
            if (!invoice.purchaseOrder?.releaseCode) throw this.sourceError(line.id)

            entries.push({
                sourceLineId: line.id,
                legalEntityId: invoice.legalEntityId,
                warehouseId,
                warehouseAreaId,
                productId: line.productId,
                supplierPartyId: invoice.supplierCustomerId,
                releaseCode: invoice.purchaseOrder.releaseCode,
                qtyDelta: new Prisma.Decimal(line.actualQty),
                valueDelta: new Prisma.Decimal(line.netAmount),
            })
        }

        return tx.accountingInventoryPosting.create({
            data: {
                postingNo: `KTM-${invoice.id}`,
                kind: AccountingInventoryPostingKind.PURCHASE_INVOICE,
                sourceType: 'SUPPLIER_INVOICE',
                sourceId: invoice.id,
                idempotencyKey,
                effectiveAt: invoice.invoiceDate,
                postedById: args.actorId ?? null,
                entries: entries.length
                    ? {
                          create: entries.map((entry, index) => ({
                              lineNo: index + 1,
                              ...entry,
                          })),
                      }
                    : undefined,
            },
        })
    }

    async postSalesInvoice(
        tx: Prisma.TransactionClient,
        args: { salesInvoiceId: string; actorId?: string | null; effectiveAt?: Date },
    ) {
        const idempotencyKey = `accounting-inventory:sales-invoice:${args.salesInvoiceId}`
        const existing = await tx.accountingInventoryPosting.findUnique({ where: { idempotencyKey } })
        if (existing) return existing

        const invoice = await tx.salesInvoice.findUnique({
            where: { id: args.salesInvoiceId },
            include: {
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        deliveryLine: {
                            include: {
                                delivery: { select: { warehouseId: true } },
                                lotAllocations: {
                                    orderBy: { createdAt: 'asc' },
                                    include: {
                                        lot: {
                                            select: {
                                                supplierPartyId: true,
                                                releaseCode: true,
                                                receivedAt: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })
        if (!invoice) throw new NotFoundException('SALES_INVOICE_NOT_FOUND')

        const reservations = await tx.inventoryReservation.findMany({
            where: {
                salesOrderId: invoice.withdrawalRequestId ? undefined : (invoice.salesOrderId ?? undefined),
                withdrawalRequestId: invoice.withdrawalRequestId ?? undefined,
                status: { in: [ReservationStatus.ACTIVE, ReservationStatus.PARTIALLY_RELEASED] },
            },
            orderBy: { reservedAt: 'asc' },
            include: {
                lines: {
                    where: { activeActualQty: { gt: 0 } },
                    orderBy: { lineNo: 'asc' },
                    include: {
                        lot: {
                            select: {
                                supplierPartyId: true,
                                releaseCode: true,
                                receivedAt: true,
                            },
                        },
                    },
                },
            },
        })
        const reservationLines = reservations.flatMap((reservation) => reservation.lines)
        const reservationRemaining = new Map(
            reservationLines.map((line) => [line.id, new Prisma.Decimal(line.activeActualQty)]),
        )

        const entries: AccountingEntryInput[] = []
        for (const invoiceLine of invoice.lines) {
            let remaining = new Prisma.Decimal(invoiceLine.qty)
            let remainingValue = new Prisma.Decimal(invoiceLine.netAmount)

            const deliverySources = (invoiceLine.deliveryLine?.lotAllocations ?? [])
                .map((allocation) => ({
                    warehouseId: invoiceLine.deliveryLine!.delivery.warehouseId,
                    supplierPartyId: allocation.lot.supplierPartyId,
                    releaseCode: allocation.lot.releaseCode,
                    availableQty: new Prisma.Decimal(allocation.actualQty),
                    receivedAt: allocation.lot.receivedAt,
                }))
                .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())

            const reservedSources = reservationLines
                .filter((line) => line.salesOrderLineId === invoiceLine.salesOrderLineId)
                .map((line) => ({
                    reservationLineId: line.id,
                    warehouseId: line.warehouseId,
                    supplierPartyId: line.lot?.supplierPartyId ?? null,
                    releaseCode: line.lot?.releaseCode ?? null,
                    availableQty: reservationRemaining.get(line.id) ?? new Prisma.Decimal(0),
                    receivedAt: line.lot?.receivedAt ?? new Date(0),
                }))
                .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime())

            const sources = deliverySources.length ? deliverySources : reservedSources
            for (const source of sources) {
                if (remaining.lessThanOrEqualTo(0)) break
                if (!source.supplierPartyId || !source.releaseCode) throw this.sourceError(invoiceLine.id)
                if (source.availableQty.lessThanOrEqualTo(0)) continue

                const usedQty = Prisma.Decimal.min(remaining, source.availableQty)
                const isLast = usedQty.equals(remaining)
                const usedValue = isLast
                    ? remainingValue
                    : new Prisma.Decimal(invoiceLine.netAmount)
                          .mul(usedQty)
                          .div(invoiceLine.qty)
                          .toDecimalPlaces(4)
                entries.push({
                    sourceLineId: invoiceLine.id,
                    legalEntityId: invoice.legalEntityId,
                    warehouseId: source.warehouseId,
                    warehouseAreaId: null,
                    productId: invoiceLine.productId,
                    supplierPartyId: source.supplierPartyId,
                    releaseCode: source.releaseCode,
                    qtyDelta: usedQty.negated(),
                    valueDelta: usedValue.negated(),
                })
                remaining = remaining.minus(usedQty)
                remainingValue = remainingValue.minus(usedValue)
                if ('reservationLineId' in source && typeof source.reservationLineId === 'string') {
                    reservationRemaining.set(source.reservationLineId, source.availableQty.minus(usedQty))
                }
            }

            if (remaining.greaterThan(0)) {
                throw new BadRequestException({
                    code: 'ACCOUNTING_INVENTORY_SOURCE_QTY_INSUFFICIENT',
                    message: 'Không xác định đủ lô/mã NCC cho toàn bộ số lượng xuất hóa đơn.',
                    salesInvoiceLineId: invoiceLine.id,
                    missingQty: remaining.toString(),
                })
            }
        }

        return tx.accountingInventoryPosting.create({
            data: {
                postingNo: `KTB-${invoice.invoiceNoInternal}`,
                kind: AccountingInventoryPostingKind.SALES_INVOICE,
                sourceType: 'SALES_INVOICE',
                sourceId: invoice.id,
                idempotencyKey,
                effectiveAt: args.effectiveAt ?? invoice.invoiceDate,
                postedById: args.actorId ?? null,
                entries: {
                    create: entries.map((entry, index) => ({ lineNo: index + 1, ...entry })),
                },
            },
        })
    }

    async reverseInvoicePosting(
        tx: Prisma.TransactionClient,
        args: {
            sourceType: 'SUPPLIER_INVOICE' | 'SALES_INVOICE'
            sourceId: string
            actorId?: string | null
            effectiveAt?: Date
        },
    ) {
        const originalKey = `accounting-inventory:${
            args.sourceType === 'SUPPLIER_INVOICE' ? 'purchase-invoice' : 'sales-invoice'
        }:${args.sourceId}`
        const original = await tx.accountingInventoryPosting.findUnique({
            where: { idempotencyKey: originalKey },
            include: { entries: { orderBy: { lineNo: 'asc' } } },
        })
        // A non-stock invoice legitimately has no accounting-stock posting in migrated data.
        if (!original) return null

        const idempotencyKey = `accounting-inventory:reversal:${args.sourceType}:${args.sourceId}`
        const existing = await tx.accountingInventoryPosting.findUnique({ where: { idempotencyKey } })
        if (existing) return existing

        return tx.accountingInventoryPosting.create({
            data: {
                postingNo: `KTD-${original.postingNo}`,
                kind: AccountingInventoryPostingKind.INVOICE_REVERSAL,
                sourceType: args.sourceType,
                sourceId: args.sourceId,
                idempotencyKey,
                reversalOfId: original.id,
                effectiveAt: args.effectiveAt ?? new Date(),
                postedById: args.actorId ?? null,
                entries: original.entries.length
                    ? {
                          create: original.entries.map((entry, index) => ({
                              lineNo: index + 1,
                              sourceLineId: entry.sourceLineId,
                              legalEntityId: entry.legalEntityId,
                              warehouseId: entry.warehouseId,
                              warehouseAreaId: entry.warehouseAreaId,
                              productId: entry.productId,
                              supplierPartyId: entry.supplierPartyId,
                              releaseCode: entry.releaseCode,
                              qtyDelta: entry.qtyDelta.negated(),
                              valueDelta: entry.valueDelta.negated(),
                          })),
                      }
                    : undefined,
            },
        })
    }
}
