import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    BankTxnReconciliationStatus,
    PaymentFundingSource,
    Prisma,
    TermBankInstructionStatus,
    TermPaymentRequestStatus,
} from '@prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { CommercialPaymentsService } from '../purchases/commercial-payments/commercial-payments.service'

type Tx = Prisma.TransactionClient

/**
 * Ghép tiền ra trên sao kê với lần chi Mua TM.
 *
 * Mỗi dòng ghép mang số tiền riêng, nên một lần chi trả từ hai tài khoản (vd. đơn
 * TM260900033: 740tr BIDV + 11,3 tỷ VCB) hay một lệnh gộp nhiều lần chi đều ghép được.
 */
@Injectable()
export class CommercialPaymentReconciliationService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly commercialPayments: CommercialPaymentsService,
    ) {}

    /** Số tiền của dòng sao kê đã được ghép với bất kỳ hồ sơ chi nào. */
    async matchedAmountOf(tx: Tx | PrismaService, bankTransactionId: string) {
        const [general, commercial, term, payable] = await Promise.all([
            tx.generalPaymentReconciliation.findMany({
                where: { bankTransactionId, reversedAt: null },
                select: { payment: { select: { amountVnd: true } } },
            }),
            tx.commercialPaymentReconciliation.aggregate({ where: { bankTransactionId, reversedAt: null }, _sum: { amountVnd: true } }),
            tx.purchaseTermBankInstruction.aggregate({
                where: { bankTransactionId, status: { not: TermBankInstructionStatus.CANCELLED } },
                _sum: { amountVnd: true },
            }),
            tx.payableAllocation.aggregate({ where: { bankTransactionId, status: 'ACTIVE' }, _sum: { amountInBankCurrency: true } }),
        ])
        return general
            .reduce((sum, row) => sum.plus(row.payment.amountVnd), new Prisma.Decimal(0))
            .plus(commercial._sum.amountVnd ?? 0)
            .plus(term._sum.amountVnd ?? 0)
            .plus(payable._sum.amountInBankCurrency ?? 0)
    }

    private async loadTransaction(tx: Tx, bankTransactionId: string) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bank:' + bankTransactionId}))`
        const transaction = await tx.bankTransaction.findUnique({ where: { id: bankTransactionId } })
        if (!transaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (transaction.direction !== BankTxnDirection.OUT) {
            throw new BadRequestException({ code: 'ONLY_OUT_TRANSACTION_SUPPORTED', message: 'Chỉ ghép được giao dịch tiền ra.' })
        }
        if (transaction.reconciliationStatus === BankTxnReconciliationStatus.IGNORED) {
            throw new BadRequestException({ code: 'BANK_TRANSACTION_IGNORED', message: 'Giao dịch này đã được bỏ qua.' })
        }
        const remaining = new Prisma.Decimal(transaction.amount).minus(await this.matchedAmountOf(tx, bankTransactionId))
        if (!remaining.greaterThan(0)) {
            throw new BadRequestException({ code: 'BANK_TRANSACTION_ALREADY_MATCHED', message: 'Giao dịch này đã được ghép đủ.' })
        }
        return { transaction, remaining }
    }

    private async link(
        tx: Tx,
        input: { bankTransactionId: string; paymentId: string; amount: Prisma.Decimal; remaining: Prisma.Decimal; supplierPartyId: string | null; note?: string },
        actorId?: string | null,
    ) {
        const reconciliation = await tx.commercialPaymentReconciliation.create({
            data: {
                bankTransactionId: input.bankTransactionId,
                paymentId: input.paymentId,
                amountVnd: input.amount,
                reconciledById: actorId ?? null,
                note: input.note?.trim() || null,
            },
        })
        const fullyMatched = input.amount.greaterThanOrEqualTo(input.remaining)
        await tx.bankTransaction.update({
            where: { id: input.bankTransactionId },
            data: {
                matchStatus: fullyMatched ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                reconciliationStatus: fullyMatched ? BankTxnReconciliationStatus.ALLOCATED : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED,
                counterpartyType: 'SUPPLIER',
                counterpartyId: input.supplierPartyId,
                isConfirmed: true,
                confirmedAt: new Date(),
                confirmedBy: actorId ?? null,
            },
        })
        await tx.auditLog.create({
            data: {
                moduleCode: 'BANKING',
                action: 'COMMERCIAL_PAYMENT_RECONCILED',
                entityId: reconciliation.id,
                userId: actorId ?? null,
                method: 'POST',
                path: `/banking/transactions/${input.bankTransactionId}/commercial-reconciliations`,
                statusCode: 200,
                after: { bankTransactionId: input.bankTransactionId, paymentId: input.paymentId, amountVnd: input.amount.toString() },
            },
        })
        return reconciliation
    }

    /** Ghép dòng sao kê với một lần chi Mua TM đã ghi nhận. */
    async reconcile(bankTransactionId: string, dto: { paymentId: string; amountVnd?: number; note?: string }, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            const { transaction, remaining } = await this.loadTransaction(tx, bankTransactionId)
            const payment = await tx.paymentRequestPayment.findUnique({
                where: { id: dto.paymentId },
                include: {
                    reconciliations: { where: { reversedAt: null }, select: { amountVnd: true } },
                    paymentRequest: { select: { purchaseOrder: { select: { supplierCustomerId: true } } } },
                },
            })
            if (!payment) throw new NotFoundException('COMMERCIAL_PAYMENT_NOT_FOUND')
            if (payment.fundingSource !== PaymentFundingSource.OWN_BANK) {
                throw new BadRequestException({ code: 'COMMERCIAL_PAYMENT_NOT_OWN_BANK', message: 'Giải ngân thẳng NCC không đi qua tài khoản công ty nên không ghép sao kê.' })
            }
            if (payment.sourceBankAccountId !== transaction.bankAccountId) {
                throw new BadRequestException({ code: 'COMMERCIAL_PAYMENT_BANK_ACCOUNT_MISMATCH', message: 'Lần chi được ghi nhận từ tài khoản khác với tài khoản của dòng sao kê.' })
            }
            const paymentRemaining = new Prisma.Decimal(payment.amountVnd).minus(
                payment.reconciliations.reduce((sum, row) => sum.plus(row.amountVnd), new Prisma.Decimal(0)),
            )
            if (!paymentRemaining.greaterThan(0)) {
                throw new BadRequestException({ code: 'COMMERCIAL_PAYMENT_ALREADY_RECONCILED', message: 'Lần chi này đã ghép đủ với sao kê.' })
            }
            const amount = dto.amountVnd ? new Prisma.Decimal(dto.amountVnd) : Prisma.Decimal.min(remaining, paymentRemaining)
            if (!amount.greaterThan(0) || amount.greaterThan(remaining) || amount.greaterThan(paymentRemaining)) {
                throw new BadRequestException({ code: 'RECONCILIATION_AMOUNT_INVALID', message: 'Số tiền ghép vượt phần còn lại của giao dịch hoặc của lần chi.' })
            }
            return this.link(
                tx,
                { bankTransactionId, paymentId: payment.id, amount, remaining, supplierPartyId: payment.paymentRequest.purchaseOrder.supplierCustomerId, note: dto.note },
                actorId,
            )
        })
    }

    /**
     * Chưa ai bấm "Ghi nhận đã chi" nhưng sao kê đã có tiền ra: lấy chính dòng sao kê làm căn cứ,
     * ghi nhận lần chi (trừ công nợ phải trả như bình thường) và ghép luôn — trong một giao dịch.
     */
    async recordFromStatement(bankTransactionId: string, dto: { paymentRequestId: string; note?: string }, actorId?: string | null) {
        const preview = await this.prisma.bankTransaction.findUnique({ where: { id: bankTransactionId } })
        if (!preview) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        const request = await this.prisma.purchaseTermPaymentRequest.findFirst({
            where: { id: dto.paymentRequestId, supplierInvoiceId: { not: null } },
            include: { payments: { select: { amountVnd: true } } },
        })
        if (!request) throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
        if (request.status !== TermPaymentRequestStatus.BANK_VERIFIED && request.status !== TermPaymentRequestStatus.PARTIALLY_PAID) {
            throw new BadRequestException({ code: 'COMMERCIAL_PAYMENT_REQUEST_NOT_READY_TO_PAY', message: 'Đề nghị chưa qua bước kiểm tra nên chưa ghi nhận chi được.' })
        }
        const requestRemaining = new Prisma.Decimal(request.amountVnd).minus(
            request.payments.reduce((sum, row) => sum.plus(row.amountVnd), new Prisma.Decimal(0)),
        )
        const txnRemaining = new Prisma.Decimal(preview.amount).minus(await this.matchedAmountOf(this.prisma, bankTransactionId))
        const amount = Prisma.Decimal.min(requestRemaining, txnRemaining)
        if (!amount.greaterThan(0)) {
            throw new BadRequestException({ code: 'NOTHING_TO_RECORD', message: 'Đề nghị đã trả đủ hoặc dòng sao kê đã ghép đủ.' })
        }
        const txnDate = preview.txnDate
        const paidAt = `${txnDate.getFullYear()}-${String(txnDate.getMonth() + 1).padStart(2, '0')}-${String(txnDate.getDate()).padStart(2, '0')}`

        return this.commercialPayments.recordPayment(
            dto.paymentRequestId,
            {
                fundingSource: 'OWN_BANK',
                sourceBankAccountId: preview.bankAccountId,
                amountVnd: Number(amount),
                paidAt,
                note: dto.note?.trim() || `Ghi nhận từ sao kê${preview.externalRef ? ` ${preview.externalRef}` : ''}`,
            },
            actorId,
            async (tx, payment) => {
                const { remaining } = await this.loadTransaction(tx, bankTransactionId)
                const supplier = await tx.purchaseTermPaymentRequest.findUnique({
                    where: { id: dto.paymentRequestId },
                    select: { purchaseOrder: { select: { supplierCustomerId: true } } },
                })
                await this.link(
                    tx,
                    {
                        bankTransactionId,
                        paymentId: payment.id,
                        amount: Prisma.Decimal.min(new Prisma.Decimal(payment.amountVnd), remaining),
                        remaining,
                        supplierPartyId: supplier?.purchaseOrder.supplierCustomerId ?? null,
                        note: dto.note,
                    },
                    actorId,
                )
            },
        )
    }

    async reverse(id: string, reason: string, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            const reconciliation = await tx.commercialPaymentReconciliation.findUnique({ where: { id }, include: { bankTransaction: true } })
            if (!reconciliation) throw new NotFoundException('COMMERCIAL_PAYMENT_RECONCILIATION_NOT_FOUND')
            if (reconciliation.reversedAt) throw new BadRequestException('COMMERCIAL_PAYMENT_RECONCILIATION_ALREADY_REVERSED')
            const updated = await tx.commercialPaymentReconciliation.update({
                where: { id },
                data: { reversedAt: new Date(), reversedById: actorId ?? null, reversalReason: reason.trim() },
            })
            const matched = await this.matchedAmountOf(tx, reconciliation.bankTransactionId)
            await tx.bankTransaction.update({
                where: { id: reconciliation.bankTransactionId },
                data: {
                    matchStatus: matched.isZero() ? BankTxnMatchStatus.UNMATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                    reconciliationStatus: matched.isZero() ? BankTxnReconciliationStatus.PENDING : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED,
                    isConfirmed: !matched.isZero(),
                    ...(matched.isZero() ? { confirmedAt: null, confirmedBy: null, counterpartyType: null, counterpartyId: null } : {}),
                },
            })
            await tx.auditLog.create({
                data: {
                    moduleCode: 'BANKING',
                    action: 'COMMERCIAL_PAYMENT_RECONCILIATION_REVERSED',
                    entityId: id,
                    userId: actorId ?? null,
                    method: 'POST',
                    path: `/banking/commercial-reconciliations/${id}/reverse`,
                    statusCode: 200,
                    before: { bankTransactionId: reconciliation.bankTransactionId, paymentId: reconciliation.paymentId, amountVnd: reconciliation.amountVnd.toString() },
                    after: { reversedAt: updated.reversedAt?.toISOString(), reversalReason: updated.reversalReason },
                },
            })
            return updated
        })
    }
}
