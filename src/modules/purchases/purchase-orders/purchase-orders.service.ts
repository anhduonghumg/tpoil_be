// src/modules/purchases/purchase-orders/purchase-orders.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseOrderStatus } from '@prisma/client'
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
                totalQty: dto.totalQty ?? lines.reduce((sum, l) => sum + l.orderedQty, 0),
                totalAmount: dto.totalAmount ?? lines.reduce((sum, l) => sum + (l.unitPrice ?? 0) * l.orderedQty - l.discountAmount, 0),

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
            include: { receipts: true },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')

        const hasConfirmedReceipt = (po.receipts ?? []).some((r) => r.status === 'CONFIRMED')
        if (hasConfirmedReceipt) throw new BadRequestException('PO_HAS_CONFIRMED_RECEIPTS')

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
                supplierLocation: { select: { id: true, code: true, name: true } }, // header default
                receipts: true,
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        supplierLocation: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        return po
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
                },
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])

        return { items, total, page, limit }
    }
}
