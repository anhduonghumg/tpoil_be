import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { ContractStatus, PaymentMode, PaymentTermType, PricingStageType, Prisma, PurchaseBizType, PurchaseOrderStatus, PurchaseOrderType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateTermPurchaseOrderDto } from './dto/create-term-purchase-order.dto'
import { ListTermPurchaseOrdersQueryDto } from './dto/list-term-purchase-orders.query.dto'
import { UpdateTermPurchaseOrderDto } from './dto/update-term-purchase-order.dto'
import { PurchaseTermMapper } from './purchase-term.mapper'
import { PurchaseTermNextActionService } from './purchase-term-next-action.service'
import dayjs from 'dayjs'

@Injectable()
export class PurchaseTermOrdersService {
    private readonly termPurchaseContractTypeId = '019f0303-32fe-73a1-84e9-76f9a0c4fa0e'

    constructor(
        private readonly prisma: PrismaService,
        private readonly nextActionService: PurchaseTermNextActionService,
    ) {}

    private toDateOnly(value?: string | Date | null): Date | undefined {
        if (!value) return undefined

        if (value instanceof Date) {
            return value
        }

        return new Date(`${value}T00:00:00.000Z`)
    }

    private dateRangeOfDay(value: Date) {
        const start = new Date(value)
        start.setUTCHours(0, 0, 0, 0)

        const end = new Date(value)
        end.setUTCHours(23, 59, 59, 999)

        return { start, end }
    }

    private readonly orderInclude = {
        supplier: true,

        supplierLocation: true,

        contract: true,

        lines: {
            include: {
                product: true,
                supplierLocation: true,
            },
            orderBy: {
                createdAt: 'asc',
            },
        },

        receipts: {
            include: {
                product: true,
                supplierLocation: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        },

        pricingRuns: {
            include: {
                stages: {
                    include: {
                        priceDays: {
                            orderBy: {
                                quoteDate: 'asc',
                            },
                        },

                        costs: true,

                        sheetRows: {
                            orderBy: {
                                sortOrder: 'asc',
                            },
                        },
                        lines: {
                            include: {
                                product: true,
                                supplierLocation: true,
                                purchaseOrderLine: true,
                            },
                            orderBy: {
                                createdAt: 'asc',
                            },
                        },
                    },
                },
            },
            orderBy: {
                createdAt: 'desc',
            },
        },

        termShipments: {
            orderBy: {
                createdAt: 'desc',
            },
        },

        termLogisticsCosts: {
            include: {
                shipment: true,
                vendor: true,
                lines: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        },
    } satisfies Prisma.PurchaseOrderInclude

    private getTermPeriod(orderDate: Date): string {
        const y = orderDate.getUTCFullYear()
        const m = String(orderDate.getUTCMonth() + 1).padStart(2, '0')

        return `${y}${m}`
    }

    private async generateOrderNo(tx: Prisma.TransactionClient, orderDate: Date, supplierCode: string): Promise<string> {
        const period = this.getTermPeriod(orderDate)

        const sequence = await tx.documentSequence.upsert({
            where: {
                moduleCode_period: {
                    moduleCode: 'PURCHASE_TERM',
                    period,
                },
            },
            create: {
                moduleCode: 'PURCHASE_TERM',
                period,
                currentNo: 1,
            },
            update: {
                currentNo: {
                    increment: 1,
                },
            },
        })

        const runningNo = String(sequence.currentNo).padStart(4, '0')
        return `TE${period}${runningNo}-${supplierCode}`
    }

    private async findValidPurchaseContract(db: Prisma.TransactionClient | PrismaService, supplierCustomerId: string, orderDate: Date) {
        const day = this.dateRangeOfDay(orderDate)

        return db.contract.findFirst({
            where: {
                customerId: supplierCustomerId,
                contractTypeId: this.termPurchaseContractTypeId,
                status: ContractStatus.Active,
                startDate: {
                    lte: day.end,
                },
                endDate: {
                    gte: day.start,
                },
                deletedAt: null,
            },
            orderBy: {
                endDate: 'asc',
            },
        })
    }

    async validateContract(supplierCustomerId: string, orderDate?: string) {
        if (!supplierCustomerId) {
            throw new BadRequestException('SUPPLIER_CUSTOMER_ID_REQUIRED')
        }

        const today = new Date().toISOString().slice(0, 10)
        const date = this.toDateOnly(orderDate ?? today)!
        const day = this.dateRangeOfDay(date)
        const contract = await this.findValidPurchaseContract(this.prisma, supplierCustomerId, date)

        if (contract) {
            return {
                valid: true,
                contract: {
                    id: contract.id,
                    code: contract.code,
                    name: contract.name,
                    startDate: contract.startDate,
                    endDate: contract.endDate,
                    status: contract.status,
                },
            }
        }

        const purchaseContracts = await this.prisma.contract.findMany({
            where: {
                customerId: supplierCustomerId,
                contractTypeId: this.termPurchaseContractTypeId,
                deletedAt: null,
            },
            select: {
                id: true,
                code: true,
                startDate: true,
                endDate: true,
                status: true,
            },
        })

        const activeOtherTypeContract = await this.prisma.contract.findFirst({
            where: {
                customerId: supplierCustomerId,
                contractTypeId: {
                    not: this.termPurchaseContractTypeId,
                },
                status: ContractStatus.Active,
                startDate: {
                    lte: day.end,
                },
                endDate: {
                    gte: day.start,
                },
                deletedAt: null,
            },
            orderBy: {
                endDate: 'asc',
            },
            select: {
                id: true,
                code: true,
                contractTypeId: true,
                contractType: {
                    select: {
                        code: true,
                        name: true,
                    },
                },
                startDate: true,
                endDate: true,
                status: true,
            },
        })

        const reason = !purchaseContracts.length
            ? activeOtherTypeContract
                ? 'CONTRACT_TYPE_NOT_TERM_PURCHASE'
                : 'NO_PURCHASE_CONTRACT'
            : purchaseContracts.some((x) => x.status === ContractStatus.Active && x.endDate < day.start)
              ? 'EXPIRED_PURCHASE_CONTRACT'
              : purchaseContracts.some((x) => x.status === ContractStatus.Active && x.startDate > day.end)
                ? 'PURCHASE_CONTRACT_NOT_YET_EFFECTIVE'
              : 'NO_VALID_PURCHASE_CONTRACT'

        const message =
            reason === 'CONTRACT_TYPE_NOT_TERM_PURCHASE'
                ? `Đối tác có hợp đồng còn hiệu lực (${activeOtherTypeContract?.code}) nhưng không đúng loại hợp đồng mua bán xăng dầu.`
                : reason === 'NO_PURCHASE_CONTRACT'
                  ? 'Nhà cung cấp chưa có hợp đồng mua bán xăng dầu'
                  : reason === 'EXPIRED_PURCHASE_CONTRACT'
                    ? 'Hợp đồng mua bán xăng dầu của nhà cung cấp đã hết hạn tại ngày hồ sơ TERM.'
                    : reason === 'PURCHASE_CONTRACT_NOT_YET_EFFECTIVE'
                      ? 'Hợp đồng mua bán xăng dầu của nhà cung cấp chưa đến ngày hiệu lực tại ngày hồ sơ TERM.'
                      : 'Nhà cung cấp chưa có hợp đồng mua bán xăng dầu hợp lệ tại ngày hồ sơ TERM.'

        return {
            valid: false,
            reason,
            message,
            checkedDate: date.toISOString().slice(0, 10),
            requiredContractTypeId: this.termPurchaseContractTypeId,
            activeOtherTypeContract,
            purchaseContracts: purchaseContracts.map((x) => ({
                ...x,
                startDate: x.startDate.toISOString().slice(0, 10),
                endDate: x.endDate.toISOString().slice(0, 10),
            })),
        }
    }

    async create(dto: CreateTermPurchaseOrderDto) {
        if (!dto.lines?.length) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINES_REQUIRED')
        }

        const orderDate = this.toDateOnly(dto.orderDate)

        if (!orderDate) {
            throw new BadRequestException('ORDER_DATE_REQUIRED')
        }

        const supplier = await this.prisma.customer.findUnique({
            where: { id: dto.supplierCustomerId },
        })

        if (!supplier) {
            throw new BadRequestException('SUPPLIER_NOT_FOUND')
        }

        if (!supplier.isSupplier) {
            throw new BadRequestException('PARTY_IS_NOT_SUPPLIER')
        }

        if (!supplier.code?.trim()) {
            throw new BadRequestException('SUPPLIER_CODE_REQUIRED_FOR_TERM_ORDER')
        }

        if (dto.supplierLocationId) {
            await this.ensureSupplierLocation(dto.supplierLocationId, dto.supplierCustomerId)
        }

        await this.validateLines(dto.lines, dto.supplierCustomerId, dto.supplierLocationId)

        const created = await this.prisma.$transaction(async (tx) => {
            const contract = await this.findValidPurchaseContract(tx, dto.supplierCustomerId, orderDate)

            if (!contract) {
                const validation = await this.validateContract(dto.supplierCustomerId, dto.orderDate)
                throw new BadRequestException(validation)
            }

            const orderNo = await this.generateOrderNo(tx, orderDate, supplier.code.trim())

            const totalQty = dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0), 0)

            const totalAmount = dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0) * Number(x.unitPrice || 0) - Number(x.discountAmount || 0), 0)

            const order = await tx.purchaseOrder.create({
                data: {
                    orderNo,
                    bizType: PurchaseBizType.TERM,
                    orderType: PurchaseOrderType.SINGLE,
                    status: PurchaseOrderStatus.DRAFT,

                    paymentMode: PaymentMode.PREPAID,
                    paymentTermType: PaymentTermType.SAME_DAY,

                    supplierCustomerId: dto.supplierCustomerId,
                    supplierLocationId: dto.supplierLocationId ?? null,

                    orderDate,
                    expectedDate: this.toDateOnly(dto.expectedDate),

                    contractId: contract.id,
                    contractNo: contract.code,
                    transportMode: dto.transportMode ?? null,
                    deliveryLocation: dto.deliveryLocation?.trim() || supplier.defaultDeliveryLocation || null,

                    paymentNote: dto.paymentNote?.trim() || null,
                    note: dto.note?.trim() || null,
                    termPremiumUsdPerBbl: dto.billInfo?.premium !== undefined && dto.billInfo.premium !== null ? new Prisma.Decimal(dto.billInfo.premium) : null,

                    totalQty,
                    totalAmount,

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

            // if (dto.billInfo) {
            //     await this.createInitialPricing(tx, order, dto.billInfo)
            // }

            return tx.purchaseOrder.findUniqueOrThrow({
                where: { id: order.id },
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
                      { supplier: { name: { contains: query.keyword, mode: 'insensitive' } } },
                      { contractNo: { contains: query.keyword, mode: 'insensitive' } },
                      { paymentNote: { contains: query.keyword, mode: 'insensitive' } },
                      { note: { contains: query.keyword, mode: 'insensitive' } },
                      {
                          lines: {
                              some: {
                                  product: {
                                      name: { contains: query.keyword, mode: 'insensitive' },
                                  },
                              },
                          },
                      },
                  ]
                : undefined,
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                include: this.orderInclude,
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
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
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
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                receipts: true,
            },
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

        if (dto.supplierLocationId && dto.supplierCustomerId) {
            await this.ensureSupplierLocation(dto.supplierLocationId, dto.supplierCustomerId)
        }

        if (dto.lines) {
            await this.validateLines(dto.lines, dto.supplierCustomerId ?? current.supplierCustomerId, dto.supplierLocationId ?? current.supplierLocationId ?? undefined)
        }

        const updated = await this.prisma.$transaction(async (tx) => {
            if (dto.lines) {
                await tx.purchaseOrderLine.deleteMany({
                    where: { purchaseOrderId: id },
                })
            }

            const totalQty = dto.lines ? dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0), 0) : undefined

            const totalAmount = dto.lines ? dto.lines.reduce((sum, x) => sum + Number(x.orderedQty || 0) * Number(x.unitPrice || 0) - Number(x.discountAmount || 0), 0) : undefined

            const order = await tx.purchaseOrder.update({
                where: { id },
                data: {
                    supplierCustomerId: dto.supplierCustomerId ?? undefined,
                    supplierLocationId: dto.supplierLocationId ?? undefined,

                    orderType: PurchaseOrderType.SINGLE,

                    orderDate: dto.orderDate !== undefined ? this.toDateOnly(dto.orderDate) : undefined,

                    expectedDate: dto.expectedDate !== undefined ? this.toDateOnly(dto.expectedDate) : undefined,

                    contractNo: dto.contractNo ?? undefined,
                    deliveryLocation: dto.deliveryLocation ?? undefined,

                    paymentNote: dto.paymentNote ?? undefined,
                    note: dto.note ?? undefined,

                    totalQty,
                    totalAmount,

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

            // if (dto.billInfo || dto.lines) {
            //     await this.syncEstimatePricing(tx, order, dto.billInfo)
            // }

            return tx.purchaseOrder.findUniqueOrThrow({
                where: { id },
                include: this.orderInclude,
            })
        })

        const nextAction = await this.nextActionService.getNextAction(updated.id)
        return PurchaseTermMapper.toOrderDetail(updated, nextAction)
    }

    async approve(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                lines: true,
                pricingRuns: {
                    include: {
                        stages: true,
                    },
                },
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        if (order.status !== PurchaseOrderStatus.DRAFT) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_IN_DRAFT')
        }

        if (!order.lines.length) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINES_REQUIRED')
        }

        const hasEstimate = order.pricingRuns.some((run) => run.stages.some((stage) => stage.stageType === PricingStageType.ESTIMATE))

        if (!hasEstimate) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_ESTIMATE_REQUIRED')
        }

        await this.prisma.purchaseOrder.update({
            where: { id },
            data: {
                status: PurchaseOrderStatus.APPROVED,
            },
        })

        return this.findById(id)
    }

    async cancel(id: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                receipts: true,
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

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
            data: {
                status: PurchaseOrderStatus.CANCELLED,
            },
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
            where: {
                id,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                receipts: true,
                pricingRuns: {
                    include: {
                        stages: true,
                    },
                },
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        const hasConfirmedReceipt = order.receipts.some((x) => x.status === 'CONFIRMED')

        if (!hasConfirmedReceipt) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_RECEIPT_REQUIRED')
        }

        const hasFinal = order.pricingRuns.some((run) => run.stages.some((s) => s.stageType === PricingStageType.FINAL))

        if (!hasFinal) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_FINAL_PRICING_REQUIRED')
        }

        await this.prisma.purchaseOrder.update({
            where: { id },
            data: {
                status: PurchaseOrderStatus.COMPLETED,
            },
        })

        return this.findById(id)
    }

    /*
    private async createInitialPricing(
        tx: Prisma.TransactionClient,
        order: any,
        billInfo: {
            premium?: number
        },
    ) {
        const premium = billInfo.premium !== undefined && billInfo.premium !== null ? new Prisma.Decimal(billInfo.premium) : null

        const run = await tx.purchasePricingRun.create({
            data: {
                purchaseOrderId: order.id,
                purchaseOrderLineId: null,
                supplierCustomerId: order.supplierCustomerId,
                productId: null,
                status: PricingRunStatus.DRAFT,
            },
            select: {
                id: true,
            },
        })

        const stage = await tx.purchasePricingStage.create({
            data: {
                runId: run.id,
                stageType: PricingStageType.ESTIMATE,
                premiumUsdPerBbl: premium,
            },
            select: {
                id: true,
            },
        })

        await tx.purchasePricingStageLine.createMany({
            data: order.lines.map((line: any) => ({
                stageId: stage.id,
                purchaseOrderLineId: line.id,
                productId: line.productId,
                supplierLocationId: line.supplierLocationId,
                qtyActual: line.orderedQty,
                premiumUsdPerBbl: premium,
            })),
        })
    }

    private async syncEstimatePricing(
        tx: Prisma.TransactionClient,
        order: any,
        billInfo?: {
            premium?: number
        },
    ) {
        const run = await tx.purchasePricingRun.findFirst({
            where: {
                purchaseOrderId: order.id,
                purchaseOrderLineId: null,
            },
            include: {
                stages: {
                    select: {
                        id: true,
                        stageType: true,
                        premiumUsdPerBbl: true,
                    },
                },
            },
        })

        if (!run) {
            await this.createInitialPricing(tx, order, billInfo ?? {})
            return
        }

        const currentStage = run.stages.find((x) => x.stageType === PricingStageType.ESTIMATE)

        const currentPremium = currentStage?.premiumUsdPerBbl ?? null

        const nextPremium = billInfo?.premium !== undefined && billInfo.premium !== null ? new Prisma.Decimal(billInfo.premium) : currentPremium

        const estimateStageId = currentStage
            ? currentStage.id
            : (
                  await tx.purchasePricingStage.create({
                      data: {
                          runId: run.id,
                          stageType: PricingStageType.ESTIMATE,
                          premiumUsdPerBbl: nextPremium,
                      },
                      select: {
                          id: true,
                      },
                  })
              ).id

        if (currentStage) {
            await tx.purchasePricingStage.update({
                where: { id: estimateStageId },
                data: {
                    premiumUsdPerBbl: nextPremium,
                },
            })
        }

        await tx.purchasePricingStageLine.deleteMany({
            where: {
                stageId: estimateStageId,
            },
        })

        await tx.purchasePricingStageLine.createMany({
            data: order.lines.map((line: any) => ({
                stageId: estimateStageId,
                purchaseOrderLineId: line.id,
                productId: line.productId,
                supplierLocationId: line.supplierLocationId,
                qtyActual: line.orderedQty,
                premiumUsdPerBbl: nextPremium,
            })),
        })
    }
        */

    private async validateLines(
        lines: Array<{
            productId: string
            supplierLocationId?: string
            orderedQty: number
        }>,
        supplierCustomerId: string,
        defaultLocationId?: string | null,
    ) {
        if (!lines.length) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_LINES_REQUIRED')
        }

        const productIds = [...new Set(lines.map((x) => x.productId))]

        const productCount = await this.prisma.product.count({
            where: {
                id: {
                    in: productIds,
                },
            },
        })

        if (productCount !== productIds.length) {
            throw new BadRequestException('INVALID_PRODUCT_IN_LINES')
        }

        for (const line of lines) {
            if (!line.productId) {
                throw new BadRequestException('PRODUCT_REQUIRED_IN_LINE')
            }

            if (!line.orderedQty || Number(line.orderedQty) <= 0) {
                throw new BadRequestException('ORDERED_QTY_MUST_BE_GT_ZERO')
            }

            const locId = line.supplierLocationId ?? defaultLocationId

            if (locId) {
                await this.ensureSupplierLocation(locId, supplierCustomerId)
            }
        }
    }

    private async ensureSupplierLocation(supplierLocationId: string, supplierCustomerId: string) {
        const location = await this.prisma.supplierLocation.findFirst({
            where: {
                id: supplierLocationId,
                supplierCustomerId,
            },
            select: {
                id: true,
            },
        })

        if (!location) {
            throw new BadRequestException('SUPPLIER_LOCATION_INVALID')
        }
    }

    async getPlattsAverage(productId: string, baseDate: string, limit = 11) {
        const take = Math.min(Math.max(Number(limit || 11), 1), 30)
        const to = dayjs(baseDate).endOf('day').toDate()

        const rows = await this.prisma.commodityPriceQuote.findMany({
            where: {
                productId,

                quoteDate: {
                    lte: to,
                },
            },

            orderBy: {
                quoteDate: 'desc',
            },
            take,
        })

        if (!rows.length) {
            return {
                avgPriceUsdPerBbl: null,
                items: [],
            }
        }

        const sortedRows = [...rows].reverse()

        const avg = sortedRows.reduce((sum, x) => sum + Number(x.priceUsdPerBbl || 0), 0) / sortedRows.length

        return {
            avgPriceUsdPerBbl: Number(avg.toFixed(4)),

            items: sortedRows.map((x) => ({
                quoteDate: x.quoteDate,

                priceUsdPerBbl: Number(x.priceUsdPerBbl),
            })),
        }
    }
}
