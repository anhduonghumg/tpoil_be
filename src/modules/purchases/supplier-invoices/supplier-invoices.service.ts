// src/modules/purchases/supplier-invoices/supplier-invoices.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { InventoryLedgerSourceType, Prisma, SettlementStatus, SettlementType, SupplierInvoiceStatus } from '@prisma/client'
import { InventoryService } from '../../inventory/inventory.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class SupplierInvoicesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryService,
    ) {}

    async create(dto: {
        supplierCustomerId: string
        invoiceNo: string
        invoiceSymbol: string
        invoiceTemplate?: string
        invoiceDate: string
        note?: string
        lines: Array<{
            supplierLocationId: string
            productId: string
            qty: number
            tempC?: number
            density?: number
            standardQtyV15?: number
            unitPrice?: number
            taxRate?: number
            goodsReceiptId?: string
        }>
    }) {
        return this.prisma.supplierInvoice.create({
            data: {
                supplierCustomerId: dto.supplierCustomerId,
                invoiceNo: dto.invoiceNo,
                invoiceSymbol: dto.invoiceSymbol,
                invoiceTemplate: dto.invoiceTemplate ?? null,
                invoiceDate: new Date(dto.invoiceDate), // @db.Date
                status: SupplierInvoiceStatus.DRAFT,
                note: dto.note ?? null,
                totalAmount: null,

                lines: {
                    create: dto.lines.map((l) => ({
                        supplierLocationId: l.supplierLocationId,
                        productId: l.productId,
                        qty: new Prisma.Decimal(l.qty),

                        tempC: l.tempC == null ? null : new Prisma.Decimal(l.tempC),
                        density: l.density == null ? null : new Prisma.Decimal(l.density),
                        standardQtyV15: l.standardQtyV15 == null ? null : new Prisma.Decimal(l.standardQtyV15),

                        unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                        taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),

                        goodsReceiptId: l.goodsReceiptId ?? null,
                    })),
                },
            },
            include: { lines: true },
        })
    }

    async detail(id: string) {
        const inv = await this.prisma.supplierInvoice.findUnique({
            where: { id },
            include: { lines: true, supplier: true, payableSettlement: true },
        })
        if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
        return inv
    }

    async post(id: string, payload?: { note?: string }) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const inv = await tx.supplierInvoice.findUnique({
                    where: { id },
                    include: { lines: true },
                })
                if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
                if (inv.status !== SupplierInvoiceStatus.DRAFT) {
                    throw new BadRequestException('INVOICE_NOT_DRAFT')
                }

                // Validate lines + supplierLocation belongs to supplier
                // + validate goodsReceipt (nếu có) là CONFIRMED và cùng supplier/location/product
                for (const line of inv.lines) {
                    const loc = await tx.supplierLocation.findUnique({
                        where: { id: line.supplierLocationId },
                        select: { supplierCustomerId: true },
                    })
                    if (!loc) throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_FOUND')
                    if (loc.supplierCustomerId !== inv.supplierCustomerId) {
                        throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_BELONG_SUPPLIER')
                    }

                    if (line.goodsReceiptId) {
                        const gr = await tx.goodsReceipt.findUnique({
                            where: { id: line.goodsReceiptId },
                            select: {
                                id: true,
                                status: true,
                                supplierCustomerId: true,
                                supplierLocationId: true,
                                productId: true,
                            },
                        })
                        if (!gr) throw new BadRequestException('INVOICE_LINE_GR_NOT_FOUND')
                        if (gr.status !== 'CONFIRMED') throw new BadRequestException('INVOICE_LINE_GR_NOT_CONFIRMED')
                        if (gr.supplierCustomerId !== inv.supplierCustomerId) {
                            throw new BadRequestException('INVOICE_LINE_GR_SUPPLIER_MISMATCH')
                        }
                        if (gr.supplierLocationId !== line.supplierLocationId) {
                            throw new BadRequestException('INVOICE_LINE_GR_LOCATION_MISMATCH')
                        }
                        if (gr.productId !== line.productId) {
                            throw new BadRequestException('INVOICE_LINE_GR_PRODUCT_MISMATCH')
                        }
                    }
                }

                // 1) compute totalAmount (simple: sum qty*unitPrice; tax xử lý tuỳ bạn)
                let total = new Prisma.Decimal(0)
                for (const line of inv.lines) {
                    const qty = new Prisma.Decimal(line.qty)
                    const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                    total = total.plus(qty.mul(unitPrice))
                }

                // 2) create settlement PAYABLE (1 invoice -> 1 settlement, clean)
                const settlement = await tx.supplierSettlement.create({
                    data: {
                        supplierCustomerId: inv.supplierCustomerId,
                        type: SettlementType.PAYABLE,
                        status: SettlementStatus.OPEN,
                        amountTotal: total,
                        amountSettled: new Prisma.Decimal(0),
                        dueDate: null,
                        note: null,
                    },
                })

                // 3) update invoice -> POSTED + link settlement
                const posted = await tx.supplierInvoice.update({
                    where: { id: inv.id },
                    data: {
                        status: SupplierInvoiceStatus.POSTED,
                        postedAt: new Date(),
                        totalAmount: total,
                        note: payload?.note ?? inv.note,
                        payableSettlementId: settlement.id,
                    },
                    include: { lines: true, payableSettlement: true },
                })

                // 4) Inventory move: Pending -> Posted, append ledger per line
                for (const line of posted.lines) {
                    await this.inventory.applyDeltaAndAppendLedger({
                        tx,
                        supplierLocationId: line.supplierLocationId,
                        productId: line.productId,
                        delta: {
                            deltaPendingDocQty: new Prisma.Decimal(line.qty).mul(-1),
                            deltaPostedQty: line.qty,
                        },
                        sourceType: InventoryLedgerSourceType.SUPPLIER_INVOICE,
                        sourceId: posted.id,
                        occurredAt: posted.invoiceDate,
                        note: payload?.note ?? null,
                    })
                }

                return posted
            })
        } catch (e: any) {
            if (e?.code === 'INVENTORY_NEGATIVE_PENDING') {
                throw new BadRequestException('INVENTORY_NEGATIVE_PENDING')
            }
            if (e?.code === 'INVENTORY_NEGATIVE_POSTED') {
                throw new BadRequestException('INVENTORY_NEGATIVE_POSTED')
            }
            throw e
        }
    }

    async void(id: string, payload?: { reason?: string }) {
        // Policy tối thiểu:
        // - Chỉ cho VOID khi chưa có allocation vào settlement
        // - Đảo inventory: Posted -> Pending
        return this.prisma.$transaction(async (tx) => {
            const inv = await tx.supplierInvoice.findUnique({
                where: { id },
                include: { lines: true, payableSettlement: { include: { allocations: true } } },
            })
            if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
            if (inv.status !== SupplierInvoiceStatus.POSTED) throw new BadRequestException('INVOICE_NOT_POSTED')

            if (inv.payableSettlement?.allocations?.length) {
                throw new BadRequestException('SETTLEMENT_ALREADY_ALLOCATED')
            }

            // mark invoice VOID
            const voided = await tx.supplierInvoice.update({
                where: { id: inv.id },
                data: { status: SupplierInvoiceStatus.VOID },
                include: { lines: true },
            })

            // reverse inventory posted -> pending
            for (const line of voided.lines) {
                await this.inventory.applyDeltaAndAppendLedger({
                    tx,
                    supplierLocationId: line.supplierLocationId,
                    productId: line.productId,
                    delta: {
                        deltaPendingDocQty: line.qty,
                        deltaPostedQty: new Prisma.Decimal(line.qty).mul(-1),
                    },
                    sourceType: InventoryLedgerSourceType.SUPPLIER_INVOICE,
                    sourceId: voided.id,
                    occurredAt: new Date(),
                    note: payload?.reason ?? null,
                })
            }

            // void settlement (since no allocations)
            if (inv.payableSettlementId) {
                await tx.supplierSettlement.update({
                    where: { id: inv.payableSettlementId },
                    data: { status: 'VOID' },
                })
            }

            return voided
        })
    }
}
