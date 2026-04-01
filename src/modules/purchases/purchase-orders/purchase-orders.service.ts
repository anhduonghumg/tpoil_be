// src/modules/purchases/purchase-orders/purchase-orders.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseOrderStatus, SupplierInvoiceStatus } from '@prisma/client'
import { ContractCheckService } from './contract-check.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PaymentTermType } from './dto/purchase-order.dto'

@Injectable()
export class PurchaseOrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly contractCheck: ContractCheckService,
    ) {}

    private normalizeDateOnly(s: string) {
        const d = new Date(s)
        if (Number.isNaN(d.getTime())) throw new BadRequestException('INVALID_DATE')
        return d
    }

    private toDateOrThrow(value: string, code: string) {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) throw new BadRequestException(code)
        return d
    }

    private async assertLocationsBelongToSupplier(args: { supplierCustomerId: string; locationIds: string[] }) {
        const { supplierCustomerId, locationIds } = args
        if (!locationIds.length) return

        const rows = await this.prisma.supplierLocation.findMany({
            where: {
                id: { in: locationIds },
                supplierCustomerId,
                isActive: true,
            },
            select: { id: true },
        })

        const ok = new Set(rows.map((x) => x.id))
        const bad = locationIds.filter((id) => !ok.has(id))
        if (bad.length) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_INVALID',
                message: 'Kho NCC không hợp lệ hoặc không thuộc NCC đã chọn.',
                invalidLocationIds: bad,
            })
        }
    }

    async create(dto: {
        orderNo: string
        supplierCustomerId: string
        supplierLocationId?: string
        orderType: any
        paymentMode: any
        paymentTermType: PaymentTermType
        paymentTermDays?: number
        allowPartialPayment?: boolean
        orderDate: string
        expectedDate?: string
        note?: string
        totalQty?: number
        totalAmount?: number
        paymentPlans?: Array<{
            dueDate: string
            amount: number
            note?: string
            sortOrder?: number
        }>
        lines: Array<{
            productId: string
            orderedQty: number
            supplierLocationId?: string
            discountAmount?: number
            unitPrice?: number
            taxRate?: number
        }>
    }) {
        const orderNo = (dto.orderNo ?? '').trim()
        if (!orderNo) throw new BadRequestException('ORDER_NO_REQUIRED')

        const orderDate = this.toDateOrThrow(dto.orderDate, 'ORDER_DATE_INVALID')
        const expectedDate = dto.expectedDate ? this.toDateOrThrow(dto.expectedDate, 'EXPECTED_DATE_INVALID') : null

        const paymentTermType = dto.paymentTermType ?? PaymentTermType.SAME_DAY
        const allowPartialPayment = dto.allowPartialPayment ?? true

        let paymentTermDays: number | null = dto.paymentTermDays ?? null
        if (paymentTermType === PaymentTermType.NET_DAYS) {
            if (!paymentTermDays || paymentTermDays <= 0) {
                throw new BadRequestException('PAYMENT_TERM_DAYS_REQUIRED')
            }
        } else {
            paymentTermDays = null
        }

        const rawPaymentPlans = Array.isArray(dto.paymentPlans) ? dto.paymentPlans : []

        const paymentPlans =
            dto.paymentMode === 'POSTPAID'
                ? rawPaymentPlans
                      .map((p, index) => ({
                          dueDate: this.toDateOrThrow(p.dueDate, 'PAYMENT_PLAN_DUE_DATE_INVALID'),
                          amount: Number(p.amount) || 0,
                          note: p.note?.trim() || null,
                          sortOrder: p.sortOrder ?? index,
                      }))
                      .filter((p) => p.amount > 0)
                : []

        if (dto.paymentMode === 'POSTPAID') {
            if (!paymentPlans.length) {
                throw new BadRequestException('PAYMENT_PLANS_REQUIRED')
            }

            for (const p of paymentPlans) {
                if (p.dueDate.getTime() < orderDate.getTime()) {
                    throw new BadRequestException('PAYMENT_PLAN_DUE_DATE_BEFORE_ORDER_DATE')
                }
            }
        }

        const rawLines = Array.isArray(dto.lines) ? dto.lines : []
        if (!rawLines.length) throw new BadRequestException('LINES_REQUIRED')

        const lines = rawLines
            .map((l) => ({
                productId: l.productId,
                orderedQty: Number(l.orderedQty) || 0,
                supplierLocationId: l.supplierLocationId ?? undefined,
                discountAmount: l.discountAmount == null ? 0 : Number(l.discountAmount) || 0,
                unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
                taxRate: l.taxRate == null ? null : Number(l.taxRate),
            }))
            .filter((l) => Boolean(l.productId) && l.orderedQty > 0)

        if (!lines.length) throw new BadRequestException('LINES_INVALID')

        const computedTotalQty = dto.totalQty ?? lines.reduce((sum, l) => sum + l.orderedQty, 0)

        const computedTotalAmount =
            dto.totalAmount ??
            lines.reduce((sum, l) => {
                const qty = l.orderedQty || 0
                const unitPrice = l.unitPrice ?? 0
                const unitDiscount = l.discountAmount ?? 0
                const taxRate = l.taxRate ?? 0

                const lineNet = qty * (unitPrice - unitDiscount)
                const lineTotal = lineNet * (1 + taxRate / 100)

                return sum + lineTotal
            }, 0)

        if (dto.paymentMode === 'POSTPAID') {
            const totalPlanned = paymentPlans.reduce((sum, p) => sum + p.amount, 0)
            const diff = Math.abs(totalPlanned - computedTotalAmount)

            if (diff > 0.01) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_TOTAL_MISMATCH',
                    message: 'Tổng kế hoạch thanh toán phải bằng tổng giá trị đơn hàng.',
                    totalPlanned,
                    totalAmount: computedTotalAmount,
                })
            }
        }

        const headerLocId = dto.supplierLocationId ?? null

        for (const l of lines) {
            const resolvedLocId = l.supplierLocationId ?? headerLocId
            if (!resolvedLocId) {
                throw new BadRequestException({
                    code: 'SUPPLIER_LOCATION_REQUIRED',
                    message: 'Mỗi dòng hàng phải chọn kho nhận (hoặc chọn kho mặc định ở đầu Hàng hoá).',
                })
            }
        }

        const allLocIds = Array.from(new Set([headerLocId, ...lines.map((x) => x.supplierLocationId)].filter(Boolean) as string[]))
        await this.assertLocationsBelongToSupplier({
            supplierCustomerId: dto.supplierCustomerId,
            locationIds: allLocIds,
        })

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: dto.supplierCustomerId,
            onDate: orderDate,
        })

        // 8) create PO
        const po = await this.prisma.purchaseOrder.create({
            data: {
                orderNo,
                supplierCustomerId: dto.supplierCustomerId,
                supplierLocationId: headerLocId,
                paymentTermType,
                paymentTermDays,
                allowPartialPayment,
                orderType: dto.orderType,
                paymentMode: dto.paymentMode,
                orderDate,
                expectedDate,
                note: dto.note?.trim() || null,
                status: PurchaseOrderStatus.DRAFT,
                totalQty: computedTotalQty,
                totalAmount: computedTotalAmount,
                paymentPlans: {
                    create: paymentPlans.map((p) => ({
                        dueDate: p.dueDate,
                        amount: new Prisma.Decimal(p.amount),
                        note: p.note,
                        sortOrder: p.sortOrder,
                    })),
                },
                lines: {
                    create: lines.map((l) => ({
                        productId: l.productId,
                        supplierLocationId: (l.supplierLocationId ?? headerLocId)!,
                        orderedQty: new Prisma.Decimal(l.orderedQty),
                        unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                        taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),
                        discountAmount: new Prisma.Decimal(l.discountAmount ?? 0),
                        withdrawnQty: new Prisma.Decimal(0),
                    })),
                },
            },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                paymentPlans: {
                    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                },
                lines: {
                    include: {
                        supplierLocation: { select: { id: true, code: true, name: true } },
                        product: { select: { id: true, name: true, code: true } },
                    },
                },
            },
        })

        return { po, warnings: { contract: warning } }
    }

    async approve(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { lines: true },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        if (po.status !== PurchaseOrderStatus.DRAFT) throw new BadRequestException('PO_NOT_DRAFT')

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: po.supplierCustomerId,
            onDate: po.orderDate,
        })

        const approved = await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.APPROVED },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        supplierLocation: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })

        return { po: approved, warnings: { contract: warning } }
    }

    async cancel(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                receipts: {
                    select: { id: true, status: true },
                },
                supplierInvoices: {
                    where: {
                        status: { in: [SupplierInvoiceStatus.DRAFT, SupplierInvoiceStatus.POSTED] },
                    },
                    select: {
                        id: true,
                        status: true,
                    },
                },
            },
        })

        if (!po) {
            throw new NotFoundException('PO_NOT_FOUND')
        }

        if (po.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('PO_ALREADY_CANCELLED')
        }

        if (po.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('PO_ALREADY_COMPLETED')
        }

        const hasConfirmedReceipt = (po.receipts ?? []).some((r) => r.status === 'CONFIRMED')
        if (hasConfirmedReceipt) {
            throw new BadRequestException('PO_HAS_CONFIRMED_RECEIPTS')
        }

        const hasInvoices = (po.supplierInvoices ?? []).length > 0
        if (hasInvoices) {
            throw new BadRequestException('PO_HAS_SUPPLIER_INVOICES')
        }

        return this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.CANCELLED },
        })
    }

    async detail(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                receipts: true,
                supplierInvoices: {
                    where: {
                        status: { not: SupplierInvoiceStatus.VOID },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        invoiceNo: true,
                        status: true,
                        createdAt: true,
                        sourceFileName: true,
                        sourceFileUrl: true,
                        sourceFileChecksum: true,
                        totalAmount: true,
                        payableSettlementId: true,
                        payableSettlement: {
                            select: {
                                id: true,
                                status: true,
                                amountTotal: true,
                                amountSettled: true,
                                dueDate: true,
                            },
                        },
                    },
                },
                paymentPlans: {
                    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        supplierLocation: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })

        if (!po) throw new NotFoundException('PO_NOT_FOUND')

        const confirmedReceiptCount = (po.receipts ?? []).filter((x) => x.status === 'CONFIRMED').length
        const invoices = po.supplierInvoices ?? []

        const settlements = invoices.map((x) => x.payableSettlement).filter(Boolean)

        const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s!.amountTotal ?? 0), 0)
        const totalSettledAmount = settlements.reduce((sum, s) => sum + Number(s!.amountSettled ?? 0), 0)


        let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID'
        if (totalSettledAmount > 0 && totalSettledAmount + 0.01 >= totalSettlementAmount && totalSettlementAmount > 0) {
            paymentStatus = 'PAID'
        } else if (totalSettledAmount > 0) {
            paymentStatus = 'PARTIALLY_PAID'
        }

        const hasInvoice = invoices.length > 0

        const summary = {
            hasReceipt: confirmedReceiptCount > 0,
            hasInvoice,
            paymentStatus,
            canCancel: !hasInvoice && confirmedReceiptCount === 0 && po.status !== PurchaseOrderStatus.CANCELLED && po.status !== PurchaseOrderStatus.COMPLETED,
            cancelBlockedReason: hasInvoice
                ? 'Đơn đã có hóa đơn nhà cung cấp'
                : confirmedReceiptCount > 0
                  ? 'Đơn đã có phiếu nhận hàng'
                  : po.status === PurchaseOrderStatus.CANCELLED
                    ? 'Đơn đã bị hủy'
                    : po.status === PurchaseOrderStatus.COMPLETED
                      ? 'Đơn đã hoàn thành'
                      : null,
            totalSettlementAmount,
            totalSettledAmount,
        }

        return {
            ...po,
            summary,
        }
    }

    async list(q: {
        keyword?: string
        supplierCustomerId?: string
        orderType?: any
        status?: PurchaseOrderStatus
        paymentMode?: any
        dateFrom?: string
        dateTo?: string
        page?: number
        limit?: number
    }) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.PurchaseOrderWhereInput = {
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            orderType: q.orderType ?? undefined,
            paymentMode: q.paymentMode ?? undefined,
            status: q.status ?? undefined,
            ...(q.dateFrom || q.dateTo
                ? {
                      orderDate: {
                          gte: q.dateFrom ? this.normalizeDateOnly(q.dateFrom) : undefined,
                          lte: q.dateTo ? this.normalizeDateOnly(q.dateTo) : undefined,
                      },
                  }
                : {}),
            ...(q.keyword
                ? {
                      OR: [{ orderNo: { contains: q.keyword.trim(), mode: 'insensitive' } }, { supplier: { name: { contains: q.keyword.trim(), mode: 'insensitive' } } }],
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                orderBy: { orderDate: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    orderNo: true,
                    supplierCustomerId: true,
                    orderType: true,
                    paymentMode: true,
                    status: true,
                    orderDate: true,
                    expectedDate: true,
                    totalQty: true,
                    totalAmount: true,
                    createdAt: true,
                    updatedAt: true,
                    supplier: { select: { id: true, code: true, name: true } },

                    receipts: {
                        where: { status: 'CONFIRMED' },
                        select: { id: true },
                    },

                    supplierInvoices: {
                        where: { status: { not: SupplierInvoiceStatus.VOID } },
                        select: {
                            id: true,
                            status: true,
                            totalAmount: true,
                            payableSettlementId: true,
                            payableSettlement: {
                                select: {
                                    id: true,
                                    status: true,
                                    amountTotal: true,
                                    amountSettled: true,
                                },
                            },
                        },
                    },
                },
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])

        const mappedItems = items.map((item) => {
            const confirmedReceiptCount = item.receipts?.length ?? 0
            const invoices = item.supplierInvoices ?? []

            const hasInvoice = invoices.length > 0
            const hasPostedInvoice = invoices.some((x) => x.status === SupplierInvoiceStatus.POSTED)

            const settlements = invoices.map((x) => x.payableSettlement).filter(Boolean)

            const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s!.amountTotal ?? 0), 0)
            const totalSettledAmount = settlements.reduce((sum, s) => sum + Number(s!.amountSettled ?? 0), 0)

            let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID'
            if (totalSettledAmount > 0 && totalSettledAmount + 0.01 >= totalSettlementAmount && totalSettlementAmount > 0) {
                paymentStatus = 'PAID'
            } else if (totalSettledAmount > 0) {
                paymentStatus = 'PARTIALLY_PAID'
            }

            let businessStatus: 'DRAFT' | 'APPROVED' | 'RECEIVED' | 'INVOICED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' = 'DRAFT'

            if (item.status === PurchaseOrderStatus.CANCELLED) {
                businessStatus = 'CANCELLED'
            } else if (paymentStatus === 'PAID') {
                businessStatus = 'PAID'
            } else if (paymentStatus === 'PARTIALLY_PAID') {
                businessStatus = 'PARTIALLY_PAID'
            } else if (hasInvoice) {
                businessStatus = 'INVOICED'
            } else if (confirmedReceiptCount > 0) {
                businessStatus = 'RECEIVED'
            } else if (item.status === PurchaseOrderStatus.APPROVED || item.status === PurchaseOrderStatus.IN_PROGRESS || item.status === PurchaseOrderStatus.COMPLETED) {
                businessStatus = 'APPROVED'
            }

            return {
                ...item,
                summary: {
                    hasReceipt: confirmedReceiptCount > 0,
                    hasInvoice,
                    hasPostedInvoice,
                    paymentStatus,
                    businessStatus,
                    canCancel: !hasInvoice && confirmedReceiptCount === 0 && item.status !== PurchaseOrderStatus.CANCELLED && item.status !== PurchaseOrderStatus.COMPLETED,
                    cancelBlockedReason: hasInvoice
                        ? 'Đơn đã có hóa đơn nhà cung cấp'
                        : confirmedReceiptCount > 0
                          ? 'Đơn đã có phiếu nhận hàng'
                          : item.status === PurchaseOrderStatus.CANCELLED
                            ? 'Đơn đã bị hủy'
                            : item.status === PurchaseOrderStatus.COMPLETED
                              ? 'Đơn đã hoàn thành'
                              : null,
                },
            }
        })

        return { items: mappedItems, total, page, limit }
    }
}
