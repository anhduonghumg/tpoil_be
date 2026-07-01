import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    PricingStageType,
    PurchaseBizType,
    PurchaseOrderStatus,
    TermBankInstructionStatus,
    TermOrderDocumentStatus,
    TermPaymentRequestStatus,
    TermSettlementAdjustmentStatus,
    TermSettlementAdjustmentType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    CreateTermBankInstructionDto,
    CreateTermPaymentRequestDto,
    CreateTermSettlementAdjustmentDto,
    MatchTermBankInstructionDto,
} from './dto/term-flow-documents.dto'

@Injectable()
export class PurchaseTermFlowDocumentsService {
    constructor(private readonly prisma: PrismaService) {}

    private toDate(value?: string | null): Date {
        return value ? new Date(`${value}T00:00:00.000Z`) : new Date()
    }

    private async getEditableOrder(purchaseOrderId: string) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: {
                id: purchaseOrderId,
                bizType: PurchaseBizType.TERM,
            },
            include: {
                supplier: true,
                termOrderDocuments: {
                    include: { lines: true },
                    orderBy: { createdAt: 'desc' },
                },
                termPaymentRequests: {
                    orderBy: { createdAt: 'desc' },
                },
                pricingRuns: {
                    include: {
                        stages: true,
                    },
                    orderBy: { createdAt: 'desc' },
                },
            },
        })

        if (!order) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        if (order.status === PurchaseOrderStatus.CANCELLED || order.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('TERM_PURCHASE_ORDER_NOT_EDITABLE')
        }

        return order
    }

    async createPaymentRequest(purchaseOrderId: string, dto: CreateTermPaymentRequestDto) {
        const order = await this.getEditableOrder(purchaseOrderId)
        const document = order.termOrderDocuments.find((x) => x.status === TermOrderDocumentStatus.ACTIVE)

        if (!document) {
            throw new BadRequestException('TERM_ORDER_DOCUMENT_REQUIRED')
        }

        const existing = order.termPaymentRequests.find((x) => x.status !== TermPaymentRequestStatus.CANCELLED)
        if (existing) {
            return existing
        }

        return this.prisma.purchaseTermPaymentRequest.create({
            data: {
                purchaseOrderId,
                orderDocumentId: document.id,
                sourcePricingStageId: document.sourcePricingStageId,
                requestNo: dto.requestNo?.trim() || `${order.orderNo}-DNTT`,
                requestDate: this.toDate(dto.requestDate),
                supplierName: order.supplier?.name || document.supplierName,
                content: dto.content?.trim() || `Đề nghị thanh toán đơn đặt hàng ${document.documentNo}`,
                amountVnd: new Prisma.Decimal(dto.amountVnd ?? document.totalAmountVnd ?? 0),
                currency: 'VND',
                paymentDeadline: dto.paymentDeadline ? this.toDate(dto.paymentDeadline) : null,
                status: TermPaymentRequestStatus.SUBMITTED,
                note: dto.note?.trim() || null,
            },
        })
    }

    async createBankInstruction(purchaseOrderId: string, dto: CreateTermBankInstructionDto) {
        const order = await this.getEditableOrder(purchaseOrderId)
        const paymentRequest =
            (dto.paymentRequestId
                ? order.termPaymentRequests.find((x) => x.id === dto.paymentRequestId && x.status !== TermPaymentRequestStatus.CANCELLED)
                : order.termPaymentRequests.find((x) => x.status !== TermPaymentRequestStatus.CANCELLED)) ?? null

        if (!paymentRequest) {
            throw new BadRequestException('TERM_PAYMENT_REQUEST_REQUIRED')
        }

        return this.prisma.purchaseTermBankInstruction.create({
            data: {
                purchaseOrderId,
                paymentRequestId: paymentRequest.id,
                instructionNo: dto.instructionNo?.trim() || null,
                instructionDate: dto.instructionDate ? this.toDate(dto.instructionDate) : new Date(),
                amountVnd: new Prisma.Decimal(dto.amountVnd ?? paymentRequest.amountVnd ?? 0),
                beneficiaryName: dto.beneficiaryName?.trim() || order.supplier?.name || null,
                beneficiaryBankAccount: dto.beneficiaryBankAccount?.trim() || null,
                beneficiaryBankName: dto.beneficiaryBankName?.trim() || null,
                content: dto.content?.trim() || `Thanh toán ${paymentRequest.requestNo}`,
                status: dto.status ?? TermBankInstructionStatus.SENT,
                note: dto.note?.trim() || null,
            },
        })
    }

    async matchBankInstruction(purchaseOrderId: string, instructionId: string, dto: MatchTermBankInstructionDto) {
        const instruction = await this.prisma.purchaseTermBankInstruction.findFirst({
            where: {
                id: instructionId,
                purchaseOrderId,
                status: {
                    not: TermBankInstructionStatus.CANCELLED,
                },
            },
        })

        if (!instruction) {
            throw new NotFoundException('TERM_BANK_INSTRUCTION_NOT_FOUND')
        }

        return this.prisma.purchaseTermBankInstruction.update({
            where: { id: instructionId },
            data: {
                bankTransactionId: dto.bankTransactionId ?? instruction.bankTransactionId,
                status: TermBankInstructionStatus.MATCHED,
                note: dto.note?.trim() || instruction.note,
            },
        })
    }

    async createSettlementAdjustment(purchaseOrderId: string, dto: CreateTermSettlementAdjustmentDto) {
        const order = await this.getEditableOrder(purchaseOrderId)
        const finalStage = order.pricingRuns.flatMap((run) => run.stages).find((stage) => stage.stageType === PricingStageType.FINAL)

        if (!finalStage) {
            throw new BadRequestException('TERM_FINAL_PRICING_REQUIRED')
        }

        const paymentRequest = order.termPaymentRequests.find((x) => x.status !== TermPaymentRequestStatus.CANCELLED)
        const paymentAmount = Number(paymentRequest?.amountVnd ?? 0)
        const finalAmount = Number(finalStage.totalAmountVnd ?? finalStage.temporaryAmountVnd ?? 0)
        const calculatedDiff = finalAmount - paymentAmount
        const amount = Math.abs(dto.amountVnd ?? calculatedDiff)

        if (!amount) {
            throw new BadRequestException('TERM_SETTLEMENT_ADJUSTMENT_AMOUNT_REQUIRED')
        }

        const adjustmentType =
            dto.adjustmentType ?? (calculatedDiff >= 0 ? TermSettlementAdjustmentType.ADDITIONAL_PAYMENT : TermSettlementAdjustmentType.REFUND)

        return this.prisma.purchaseTermSettlementAdjustment.create({
            data: {
                purchaseOrderId,
                finalPricingStageId: finalStage.id,
                adjustmentType,
                amountVnd: new Prisma.Decimal(amount),
                reason: dto.reason?.trim() || null,
                status: TermSettlementAdjustmentStatus.DRAFT,
                note: dto.note?.trim() || null,
            },
        })
    }
}
