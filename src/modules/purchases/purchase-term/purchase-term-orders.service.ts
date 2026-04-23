import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PaymentTermType, PurchaseBizType, PurchaseOrderStatus, Prisma } from '@prisma/client'
import { CreateTermPurchaseOrderDto } from './dto/create-term-purchase-order.dto'
import { ListTermPurchaseOrdersQueryDto } from './dto/list-term-purchase-orders.query.dto'
import { UpdateTermPurchaseOrderDto } from './dto/update-term-purchase-order.dto'
import { PurchaseTermMapper } from './purchase-term.mapper'
import { PurchaseTermNextActionService } from './purchase-term-next-action.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class PurchaseTermOrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly nextActionService: PurchaseTermNextActionService,
    ) {}

    private async generateOrderNo(tx: Prisma.TransactionClient): Promise<string> {
        const now = new Date()
        const y = now.getFullYear()
        const m = String(now.getMonth() + 1).padStart(2, '0')
        const prefix = `POTERM${y}${m}`
        const count = await tx.purchaseOrder.count({ where: { orderNo: { startsWith: prefix } } })
        return `${prefix}-${String(count + 1).padStart(4, '0')}`
    }

    private orderInclude = {
        supplier: true,
        supplierLocation: true,
        lines: {
            include: {
                product: true,
                supplierLocation: true,
            },
            orderBy: { createdAt: 'asc' as const },
        },
        receipts: {
            include: { product: true },
            orderBy: { createdAt: 'desc' as const },
        },
        pricingRuns: {
            include: {
                product: true,
                stages: true,
            },
            orderBy: { createdAt: 'desc' as const },
        },
    }
    async create(dto: CreateTermPurchaseOrderDto) {
        if (!dto.lines?.length) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINES_REQUIRED')
        }

        const supplier = await this.prisma.customer.findUnique({ where: { id: dto.supplierCustomerId } })
        if (!supplier) {
            throw new BadRequestException('SUPPLIER_NOT_FOUND')
        }

        const created = await this.prisma.$transaction(async (tx) => {
            const orderNo = await this.generateOrderNo(tx)
            return tx.purchaseOrder.create({
                data: {
                    orderNo,
                    bizType: PurchaseBizType.TERM,
                    supplierCustomerId: dto.supplierCustomerId,
                    supplierLocationId: dto.supplierLocationId ?? null,
                    orderType: dto.orderType,
                    status: PurchaseOrderStatus.DRAFT,
                    paymentMode: dto.paymentMode,
                    paymentTermType: dto.paymentTermType ?? PaymentTermType.SAME_DAY,
                    paymentTermDays: dto.paymentTermDays ?? null,
                    orderDate: dto.orderDate,
                    expectedDate: dto.expectedDate ?? null,
                    note: dto.note ?? null,
                    contractNo: dto.contractNo ?? supplier.defaultPurchaseContractNo ?? null,
                    deliveryLocation: dto.deliveryLocation ?? supplier.defaultDeliveryLocation ?? null,
                    totalQty: dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0), 0),
                    totalAmount: dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0) * Number(x.unitPrice || 0) - Number(x.discountAmount || 0), 0),
                    lines: {
                        create: dto.lines.map((x) => ({
                            productId: x.productId,
                            supplierLocationId: x.supplierLocationId ?? dto.supplierLocationId ?? null,
                            orderedQty: x.orderedQty,
                            unitPrice: x.unitPrice ?? null,
                            taxRate: x.taxRate ?? null,
                            discountAmount: x.discountAmount ?? 0,
                        })),
                    },
                },
                include: this.orderInclude,
            })
        })

        const nextAction = await this.nextActionService.getNextAction(created.id)
        return PurchaseTermMapper.toOrderDetail(created, nextAction)
    }

    async list(query: ListTermPurchaseOrdersQueryDto) {
        const page = Math.max(Number(query.page || 1), 1)
        const pageSize = Math.min(Math.max(Number(query.pageSize || 20), 1), 100)

        const where: Prisma.PurchaseOrderWhereInput = {
            bizType: PurchaseBizType.TERM,
            status: query.status ?? undefined,
            orderType: query.orderType ?? undefined,
            paymentMode: query.paymentMode ?? undefined,
            supplierCustomerId: query.supplierCustomerId ?? undefined,
            orderDate:
                query.fromDate || query.toDate
                    ? {
                          gte: query.fromDate ?? undefined,
                          lte: query.toDate ?? undefined,
                      }
                    : undefined,
            OR: query.keyword
                ? [
                      { orderNo: { contains: query.keyword, mode: 'insensitive' } },
                      { note: { contains: query.keyword, mode: 'insensitive' } },
                      { supplier: { name: { contains: query.keyword, mode: 'insensitive' } } },
                      { contractNo: { contains: query.keyword, mode: 'insensitive' } },
                  ]
                : undefined,
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                include: {
                    supplier: true,
                    lines: { include: { product: true } },
                },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])

        const mapped = await Promise.all(
            items.map(async (item) => {
                const nextAction = await this.nextActionService.getNextAction(item.id)
                return PurchaseTermMapper.toOrderListItem(item, nextAction)
            }),
        )

        return {
            items: mapped,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        }
    }

    async findById(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id, bizType: PurchaseBizType.TERM },
            include: this.orderInclude,
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        const nextAction = await this.nextActionService.getNextAction(order.id)
        return PurchaseTermMapper.toOrderDetail(order, nextAction)
    }

    async update(id: string, dto: UpdateTermPurchaseOrderDto) {
        const current = await this.prisma.purchaseOrder.findFirst({
            where: { id, bizType: PurchaseBizType.TERM },
            include: { receipts: true },
        })

        if (!current) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        if (current.status === PurchaseOrderStatus.CANCELLED || current.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_EDITABLE')
        }

        const hasConfirmedReceipt = current.receipts.some((x) => x.status === 'CONFIRMED')
        if (hasConfirmedReceipt) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_HAS_CONFIRMED_RECEIPT_NOT_EDITABLE')
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            if (dto.lines) {
                await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } })
            }

            return tx.purchaseOrder.update({
                where: { id },
                data: {
                    supplierCustomerId: dto.supplierCustomerId ?? undefined,
                    supplierLocationId: dto.supplierLocationId ?? undefined,
                    orderType: dto.orderType ?? undefined,
                    paymentMode: dto.paymentMode ?? undefined,
                    paymentTermType: dto.paymentTermType ?? undefined,
                    paymentTermDays: dto.paymentTermDays ?? undefined,
                    orderDate: dto.orderDate ?? undefined,
                    expectedDate: dto.expectedDate ?? undefined,
                    note: dto.note ?? undefined,
                    contractNo: dto.contractNo ?? undefined,
                    deliveryLocation: dto.deliveryLocation ?? undefined,
                    totalQty: dto.lines ? dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0), 0) : undefined,
                    totalAmount: dto.lines
                        ? dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0) * Number(x.unitPrice || 0) - Number(x.discountAmount || 0), 0)
                        : undefined,
                    lines: dto.lines
                        ? {
                              create: dto.lines.map((x) => ({
                                  productId: x.productId,
                                  supplierLocationId: x.supplierLocationId ?? dto.supplierLocationId ?? null,
                                  orderedQty: x.orderedQty,
                                  unitPrice: x.unitPrice ?? null,
                                  taxRate: x.taxRate ?? null,
                                  discountAmount: x.discountAmount ?? 0,
                              })),
                          }
                        : undefined,
                },
                include: this.orderInclude,
            })
        })

        const nextAction = await this.nextActionService.getNextAction(updated.id)
        return PurchaseTermMapper.toOrderDetail(updated, nextAction)
    }

    async approve(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id, bizType: PurchaseBizType.TERM },
            include: { lines: true },
        })

        if (!order) throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        if (order.status !== PurchaseOrderStatus.DRAFT) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_IN_DRAFT')
        }
        if (!order.lines.length) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINES_REQUIRED')
        }

        await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.APPROVED },
        })

        return this.findById(id)
    }

    async cancel(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id, bizType: PurchaseBizType.TERM },
            include: { receipts: true },
        })

        if (!order) throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        if (order.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_ALREADY_CANCELLED')
        }
        if (order.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_ALREADY_COMPLETED')
        }

        const hasConfirmedReceipt = order.receipts.some((x) => x.status === 'CONFIRMED')
        if (hasConfirmedReceipt) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_HAS_CONFIRMED_RECEIPT_CANNOT_CANCEL')
        }

        await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.CANCELLED },
        })

        return this.findById(id)
    }

    async getNextAction(id: string) {
        return {
            nextAction: await this.nextActionService.getNextAction(id),
        }
    }

    async complete(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id, bizType: PurchaseBizType.TERM },
            include: {
                receipts: true,
                pricingRuns: { include: { stages: true } },
            },
        })

        if (!order) throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')

        const hasConfirmedReceipt = order.receipts.some((x) => x.status === 'CONFIRMED')
        if (!hasConfirmedReceipt) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_RECEIPT_REQUIRED')
        }

        const hasFinal = order.pricingRuns.some((run) => run.stages.some((s) => s.stageType === 'FINAL'))
        if (!hasFinal) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_FINAL_PRICING_REQUIRED')
        }

        await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.COMPLETED },
        })

        return this.findById(id)
    }
}
