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
        lines: Array<{ productId: string; orderedQty: number; unitPrice?: number; taxRate?: number }>
    }) {
        const orderDate = new Date(dto.orderDate)

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

        if (dto.supplierLocationId) {
            const loc = await this.prisma.supplierLocation.findFirst({
                where: {
                    id: dto.supplierLocationId,
                    supplierCustomerId: dto.supplierCustomerId,
                    isActive: true,
                },
                select: { id: true },
            })
            if (!loc) throw new BadRequestException('SUPPLIER_LOCATION_INVALID')
        }

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: dto.supplierCustomerId,
            onDate: orderDate,
        })

        const po = await this.prisma.purchaseOrder.create({
            data: {
                orderNo: dto.orderNo,
                supplierCustomerId: dto.supplierCustomerId,

                supplierLocationId: dto.supplierLocationId ?? null,
                paymentTermType,
                paymentTermDays,
                allowPartialPayment,

                orderType: dto.orderType,
                paymentMode: dto.paymentMode,

                orderDate,
                expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
                note: dto.note ?? null,
                status: PurchaseOrderStatus.DRAFT,

                lines: {
                    create: dto.lines.map((l) => ({
                        productId: l.productId,
                        orderedQty: new Prisma.Decimal(l.orderedQty),
                        unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                        taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),
                        withdrawnQty: new Prisma.Decimal(0),
                    })),
                },
            },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                lines: true,
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
        if (po.status !== PurchaseOrderStatus.DRAFT) {
            throw new BadRequestException('PO_NOT_DRAFT')
        }

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: po.supplierCustomerId,
            onDate: po.orderDate,
        })

        const approved = await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.APPROVED },
            include: { lines: true },
        })

        return { po: approved, warnings: { contract: warning } }
    }

    async cancel(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { receipts: true },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')

        const hasConfirmedReceipt = po.receipts?.some((r) => r.status === 'CONFIRMED')
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
                lines: true,
                receipts: true,
                supplier: true,
                supplierLocation: true,
            },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        return po
    }

    async list(q: { keyword?: string; supplierCustomerId?: string; orderType?: any; paymentMode?: any; dateFrom?: string; dateTo?: string; page?: number; limit?: number }) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.PurchaseOrderWhereInput = {
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            orderType: q.orderType ?? undefined,
            paymentMode: q.paymentMode ?? undefined,
            ...(q.dateFrom || q.dateTo
                ? {
                      orderDate: {
                          gte: q.dateFrom ? new Date(q.dateFrom) : undefined,
                          lte: q.dateTo ? new Date(q.dateTo) : undefined,
                      },
                  }
                : {}),
            ...(q.keyword
                ? {
                      OR: [{ orderNo: { contains: q.keyword, mode: 'insensitive' } }, { supplier: { name: { contains: q.keyword, mode: 'insensitive' } } }],
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                orderBy: { orderDate: 'desc' },
                skip,
                take: limit,
                include: { supplier: true },
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])

        return { items, total, page, limit }
    }
}
