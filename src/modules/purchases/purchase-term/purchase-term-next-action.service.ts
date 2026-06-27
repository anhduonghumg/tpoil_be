import { Injectable, NotFoundException } from '@nestjs/common'
import { PurchaseBizType, PurchaseOrderStatus, PricingRunStatus, PricingStageType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type TermPurchaseNextAction =
    | 'APPROVE_ORDER'
    | 'CREATE_RECEIPT'
    | 'CALCULATE_TEMP_PRICE'
    | 'CALCULATE_INVOICE_PRICE'
    | 'CALCULATE_OFFICIAL_FX'
    | 'COMPLETE_ORDER'
    | 'VIEW_ONLY'

@Injectable()
export class PurchaseTermNextActionService {
    constructor(private readonly prisma: PrismaService) {}

    async getNextAction(purchaseOrderId: string): Promise<TermPurchaseNextAction> {
        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            include: {
                receipts: true,
                pricingRuns: {
                    include: {
                        stages: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        })

        if (!order || order.bizType !== PurchaseBizType.TERM) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        if (order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.COMPLETED) {
            return 'VIEW_ONLY'
        }

        const stages = order.pricingRuns.flatMap((x) => x.stages)

        const hasEstimate = stages.some((x) => x.stageType === PricingStageType.ESTIMATE)
        const hasBillNormalize = stages.some((x) => x.stageType === PricingStageType.BILL_NORMALIZE)
        const hasFinal = stages.some((x) => x.stageType === PricingStageType.FINAL)

        if (!hasEstimate) {
            return 'CALCULATE_TEMP_PRICE'
        }

        if (order.status === PurchaseOrderStatus.DRAFT) {
            return 'APPROVE_ORDER'
        }

        const confirmedReceipts = order.receipts.filter((x) => x.status === 'CONFIRMED')

        if (!confirmedReceipts.length) {
            return 'CREATE_RECEIPT'
        }

        if (!hasBillNormalize) {
            return 'CALCULATE_INVOICE_PRICE'
        }

        if (!hasFinal) {
            return 'CALCULATE_OFFICIAL_FX'
        }

        const hasPostedRun = order.pricingRuns.some((x) => x.status === PricingRunStatus.POSTED)

        if (!hasPostedRun) {
            return 'COMPLETE_ORDER'
        }

        return 'VIEW_ONLY'
    }
}
