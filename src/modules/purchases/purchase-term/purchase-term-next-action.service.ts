import { Injectable, NotFoundException } from '@nestjs/common'
import {
    PricingRunStatus,
    PricingStageType,
    PurchaseBizType,
    PurchaseOrderStatus,
    TermBankInstructionStatus,
    TermPaymentRequestStatus,
    TermPurchaseFlowType,
    TermSettlementAdjustmentStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type TermPurchaseNextAction =
    | 'APPROVE_ORDER'
    | 'CREATE_ORDER_DOCUMENT'
    | 'CREATE_PAYMENT_REQUEST'
    | 'CREATE_BANK_INSTRUCTION'
    | 'MATCH_BANK_TRANSACTION'
    | 'CREATE_RECEIPT'
    | 'CALCULATE_TEMP_PRICE'
    | 'CALCULATE_INVOICE_PRICE'
    | 'CALCULATE_OFFICIAL_FX'
    | 'CREATE_SETTLEMENT_ADJUSTMENT'
    | 'CREATE_BOSS_SHEET'
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
                termOrderDocuments: true,
                termPaymentRequests: {
                    include: {
                        batchItems: true,
                    },
                },
                termBankInstructions: true,
                termSettlementAdjustments: true,
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

        const latestStage = (stageType: PricingStageType) => stages.find((x) => x.stageType === stageType) ?? null
        const hasEstimate = !!latestStage(PricingStageType.ESTIMATE)
        const hasBillNormalize = stages.some((x) => x.stageType === PricingStageType.BILL_NORMALIZE)
        const finalStage = latestStage(PricingStageType.FINAL)
        const hasFinal = !!finalStage
        const hasBossSheet = stages.some((x) => x.stageType === PricingStageType.BOSS_SHEET)
        const flowType = order.termFlowType ?? TermPurchaseFlowType.ESTIMATE_FIRST

        if (flowType === TermPurchaseFlowType.ESTIMATE_FIRST && !hasEstimate) {
            return 'CALCULATE_TEMP_PRICE'
        }

        const activeOrderDocument = order.termOrderDocuments.find((x) => x.status === 'ACTIVE')
        if (!activeOrderDocument) {
            return 'CREATE_ORDER_DOCUMENT'
        }

        const paymentRequest = order.termPaymentRequests.find((x) => x.status !== TermPaymentRequestStatus.CANCELLED)
        if (!paymentRequest) {
            return 'CREATE_PAYMENT_REQUEST'
        }

        const hasSentToBankBatchItem = order.termPaymentRequests.some((request) =>
            request.batchItems.some((item) => item.status === 'SENT' || item.status === 'PARTIALLY_PAID' || item.status === 'PAID' || !!item.bankTransactionId),
        )
        const bankInstruction = order.termBankInstructions.find((x) => x.status !== TermBankInstructionStatus.CANCELLED)
        if (!bankInstruction && !hasSentToBankBatchItem) {
            return 'CREATE_BANK_INSTRUCTION'
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

        const paymentAmount = Number(paymentRequest.amountVnd ?? 0)
        const finalAmount = Number(finalStage?.totalAmountVnd ?? finalStage?.temporaryAmountVnd ?? 0)
        const hasPaymentDifference = Number.isFinite(paymentAmount) && Number.isFinite(finalAmount) && Math.abs(finalAmount - paymentAmount) >= 1
        const hasAdjustment = order.termSettlementAdjustments.some((x) => x.status !== TermSettlementAdjustmentStatus.CANCELLED)
        if (hasPaymentDifference && !hasAdjustment) {
            return 'CREATE_SETTLEMENT_ADJUSTMENT'
        }

        if (!hasBossSheet) {
            return 'CREATE_BOSS_SHEET'
        }

        const hasPostedRun = order.pricingRuns.some((x) => x.status === PricingRunStatus.POSTED)

        if (!hasPostedRun) {
            return 'COMPLETE_ORDER'
        }

        return 'VIEW_ONLY'
    }
}
