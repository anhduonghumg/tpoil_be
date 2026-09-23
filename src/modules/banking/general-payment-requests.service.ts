import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    BankTxnReconciliationStatus,
    GeneralPaymentRequestStatus,
    PaymentFundingSource,
    Prisma,
} from '@prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import {
    CreateGeneralPaymentRequestDto,
    GeneralPaymentRequestDecisionDto,
    RecordGeneralPaymentDto,
    MatchGeneralPaymentReconciliationDto,
    ReverseGeneralPaymentReconciliationDto,
} from './general-payment-request.dto'

@Injectable()
export class GeneralPaymentRequestsService {
    constructor(private readonly prisma: PrismaService) {}

    async list() {
        const requests = await this.prisma.generalPaymentRequest.findMany({
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            include: {
                payments: {
                    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
                    include: {
                        sourceBankAccount: {
                            select: { id: true, bankCode: true, bankName: true, accountNo: true },
                        },
                    },
                },
            },
        })
        return requests.map((request) => {
            const paidAmount = request.payments.reduce(
                (sum, payment) => sum.plus(payment.amountVnd),
                new Prisma.Decimal(0),
            )
            return {
                ...request,
                paidAmount,
                remainingAmount: request.amountVnd.minus(paidAmount),
            }
        })
    }

    async create(dto: CreateGeneralPaymentRequestDto, actorId?: string | null) {
        const requestDate = new Date(dto.requestDate)
        const period = dto.requestDate.slice(0, 7).replace('-', '')
        return this.prisma.$transaction(async (tx) => {
            const sequence = await tx.documentSequence.upsert({
                where: { moduleCode_period: { moduleCode: 'GENERAL_PAYMENT_REQUEST', period } },
                create: { moduleCode: 'GENERAL_PAYMENT_REQUEST', period, currentNo: 1 },
                update: { currentNo: { increment: 1 } },
                select: { currentNo: true },
            })
            return tx.generalPaymentRequest.create({
                data: {
                    requestNo: `DNC-${period}-${String(sequence.currentNo).padStart(5, '0')}`,
                    requestDate,
                    category: dto.category,
                    beneficiaryName: dto.beneficiaryName.trim(),
                    beneficiaryTaxCode: dto.beneficiaryTaxCode?.trim() || null,
                    beneficiaryAccountNo: dto.beneficiaryAccountNo?.trim() || null,
                    beneficiaryAccountName: dto.beneficiaryAccountName?.trim() || null,
                    beneficiaryBankName: dto.beneficiaryBankName?.trim() || null,
                    content: dto.content.trim(),
                    referenceNo: dto.referenceNo?.trim() || null,
                    invoiceNo: dto.invoiceNo?.trim() || null,
                    amountVnd: new Prisma.Decimal(dto.amountVnd),
                    paymentDeadline: dto.paymentDeadline ? new Date(dto.paymentDeadline) : null,
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                },
            })
        })
    }

    async decide(id: string, approve: boolean, note: string | undefined, actorId?: string | null) {
        const request = await this.find(id)
        if (request.status !== GeneralPaymentRequestStatus.PENDING_APPROVAL) {
            throw new BadRequestException('GENERAL_PAYMENT_REQUEST_NOT_PENDING_APPROVAL')
        }
        return this.prisma.generalPaymentRequest.update({
            where: { id },
            data: approve
                ? {
                      status: GeneralPaymentRequestStatus.APPROVED,
                      approvedById: actorId ?? null,
                      approvedAt: new Date(),
                      approvalNote: note?.trim() || null,
                  }
                : {
                      status: GeneralPaymentRequestStatus.REJECTED,
                      approvalNote: note?.trim() || null,
                  },
        })
    }

    async bankCheck(id: string, verified: boolean, note: string | undefined, actorId?: string | null) {
        const request = await this.find(id)
        if (request.status !== GeneralPaymentRequestStatus.APPROVED) {
            throw new BadRequestException('GENERAL_PAYMENT_REQUEST_NOT_READY_FOR_BANK_CHECK')
        }
        if (verified && (!request.beneficiaryAccountNo || !request.beneficiaryBankName)) {
            throw new BadRequestException('BENEFICIARY_BANK_ACCOUNT_REQUIRED')
        }
        return this.prisma.generalPaymentRequest.update({
            where: { id },
            data: verified
                ? {
                      status: GeneralPaymentRequestStatus.BANK_VERIFIED,
                      bankCheckedById: actorId ?? null,
                      bankCheckedAt: new Date(),
                      bankCheckNote: note?.trim() || null,
                  }
                : {
                      status: GeneralPaymentRequestStatus.BANK_RETURNED,
                      returnedReason: note?.trim() || 'Hồ sơ chưa đủ điều kiện thanh toán',
                  },
        })
    }

    async resubmit(id: string, dto: GeneralPaymentRequestDecisionDto) {
        const request = await this.find(id)
        const resubmittableStatuses: GeneralPaymentRequestStatus[] = [
            GeneralPaymentRequestStatus.REJECTED,
            GeneralPaymentRequestStatus.BANK_RETURNED,
        ]
        if (!resubmittableStatuses.includes(request.status)) {
            throw new BadRequestException('GENERAL_PAYMENT_REQUEST_NOT_RETURNED')
        }
        return this.prisma.generalPaymentRequest.update({
            where: { id },
            data: {
                status: GeneralPaymentRequestStatus.PENDING_APPROVAL,
                note: dto.note?.trim() || request.note,
                beneficiaryAccountNo: dto.beneficiaryAccountNo?.trim() || request.beneficiaryAccountNo,
                beneficiaryAccountName: dto.beneficiaryAccountName?.trim() || request.beneficiaryAccountName,
                beneficiaryBankName: dto.beneficiaryBankName?.trim() || request.beneficiaryBankName,
                returnedReason: null,
            },
        })
    }

    async recordPayment(id: string, dto: RecordGeneralPaymentDto, actorId?: string | null) {
        const fundingSource = dto.fundingSource === 'DIRECT_DISBURSEMENT'
            ? PaymentFundingSource.DIRECT_DISBURSEMENT
            : PaymentFundingSource.OWN_BANK
        return this.prisma.$transaction(async (tx) => {
            const request = await tx.generalPaymentRequest.findUnique({
                where: { id },
                include: { payments: true },
            })
            if (!request) throw new NotFoundException('GENERAL_PAYMENT_REQUEST_NOT_FOUND')
            const payableStatuses: GeneralPaymentRequestStatus[] = [
                GeneralPaymentRequestStatus.BANK_VERIFIED,
                GeneralPaymentRequestStatus.PARTIALLY_PAID,
            ]
            if (!payableStatuses.includes(request.status)) {
                throw new BadRequestException('GENERAL_PAYMENT_REQUEST_NOT_READY_FOR_PAYMENT')
            }
            const paidAmount = request.payments.reduce(
                (sum, payment) => sum.plus(payment.amountVnd),
                new Prisma.Decimal(0),
            )
            const remainingAmount = request.amountVnd.minus(paidAmount)
            const amount = new Prisma.Decimal(dto.amountVnd)
            if (amount.greaterThan(remainingAmount)) {
                throw new BadRequestException('GENERAL_PAYMENT_AMOUNT_EXCEEDS_REMAINING')
            }
            const source = fundingSource === PaymentFundingSource.OWN_BANK
                ? await tx.bankAccount.findFirst({ where: { id: dto.sourceBankAccountId, isActive: true } })
                : null
            if (fundingSource === PaymentFundingSource.OWN_BANK && !source) {
                throw new BadRequestException('SOURCE_BANK_ACCOUNT_INVALID')
            }
            if (fundingSource === PaymentFundingSource.DIRECT_DISBURSEMENT && (!dto.lenderBankName?.trim() || !dto.disbursementNo?.trim() || !dto.proofFileUrl?.trim())) {
                throw new BadRequestException('DIRECT_DISBURSEMENT_EVIDENCE_REQUIRED')
            }
            await tx.generalPaymentRequestPayment.create({
                data: {
                    paymentRequestId: id,
                    fundingSource,
                    sourceBankAccountId: source?.id ?? null,
                    lenderBankName: fundingSource === PaymentFundingSource.DIRECT_DISBURSEMENT ? dto.lenderBankName?.trim() || null : null,
                    creditFacilityRef: fundingSource === PaymentFundingSource.DIRECT_DISBURSEMENT ? dto.creditFacilityRef?.trim() || null : null,
                    disbursementNo: fundingSource === PaymentFundingSource.DIRECT_DISBURSEMENT ? dto.disbursementNo?.trim() || null : null,
                    amountVnd: amount,
                    paidAt: new Date(dto.paidAt),
                    proofFileUrl: dto.proofFileUrl?.trim() || null,
                    proofFileName: dto.proofFileName?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                },
            })
            const newRemaining = remainingAmount.minus(amount)
            return tx.generalPaymentRequest.update({
                where: { id },
                data: { status: newRemaining.lessThanOrEqualTo(0) ? GeneralPaymentRequestStatus.PAID : GeneralPaymentRequestStatus.PARTIALLY_PAID },
            })
        })
    }

    async reconciliationQueue() {
        const [transactions, payments] = await Promise.all([
            this.prisma.bankTransaction.findMany({
                where: {
                    direction: BankTxnDirection.OUT,
                    payableAllocations: { none: { status: 'ACTIVE' } },
                    // Bỏ dòng đã loại (chuyển nội bộ, phí) và dòng đã ghép với Mua TM / bảng kê TERM;
                    // chỉ giữ dòng chưa ghép, hoặc dòng đang ghép dở với chính hồ sơ chi khác.
                    reconciliationStatus: { not: BankTxnReconciliationStatus.IGNORED },
                    OR: [{ matchStatus: BankTxnMatchStatus.UNMATCHED }, { generalPaymentReconciliations: { some: { reversedAt: null } } }],
                    commercialPaymentReconciliations: { none: { reversedAt: null } },
                },
                select: {
                    id: true, bankAccountId: true, txnDate: true, amount: true,
                    description: true, counterpartyName: true, counterpartyAcc: true, externalRef: true,
                    bankAccount: { select: { bankCode: true, accountNo: true } },
                    generalPaymentReconciliations: { where: { reversedAt: null }, include: { payment: { select: { amountVnd: true } } } },
                },
                orderBy: { txnDate: 'desc' },
                take: 50,
            }),
            this.prisma.generalPaymentRequestPayment.findMany({
                where: {
                    fundingSource: PaymentFundingSource.OWN_BANK,
                    reconciliations: { none: { reversedAt: null } },
                },
                include: {
                    paymentRequest: { select: { requestNo: true, beneficiaryName: true, content: true, status: true } },
                    sourceBankAccount: { select: { bankCode: true, accountNo: true } },
                },
                orderBy: { paidAt: 'desc' },
                take: 100,
            }),
        ])
        return transactions.map((transaction) => {
            const allocatedAmount = transaction.generalPaymentReconciliations.reduce((sum, item) => sum.plus(item.payment.amountVnd), new Prisma.Decimal(0))
            const remainingAmount = new Prisma.Decimal(transaction.amount).minus(allocatedAmount)
            const candidates = payments
                .filter((payment) =>
                    payment.sourceBankAccountId === transaction.bankAccountId
                    && new Prisma.Decimal(payment.amountVnd).lessThanOrEqualTo(remainingAmount),
                )
                .map((payment) => ({
                    paymentId: payment.id,
                    requestNo: payment.paymentRequest.requestNo,
                    beneficiaryName: payment.paymentRequest.beneficiaryName,
                    content: payment.paymentRequest.content,
                    amountVnd: Number(payment.amountVnd),
                    paidAt: payment.paidAt,
                    score: this.reconciliationScore(transaction.description, transaction.counterpartyName, payment.paymentRequest.beneficiaryName, payment.paymentRequest.content),
                }))
                .sort((a, b) => b.score - a.score)
            return { ...transaction, amount: Number(transaction.amount), allocatedAmount: Number(allocatedAmount), remainingAmount: Number(remainingAmount), candidates }
        }).filter((transaction) => transaction.remainingAmount > 0)
    }

    async reconcile(bankTransactionId: string, dto: MatchGeneralPaymentReconciliationDto, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            const [transaction, payment] = await Promise.all([
                tx.bankTransaction.findUnique({
                    where: { id: bankTransactionId },
                    include: { payableAllocations: { where: { status: 'ACTIVE' } }, generalPaymentReconciliations: { where: { reversedAt: null }, include: { payment: { select: { amountVnd: true } } } }, },
                }),
                tx.generalPaymentRequestPayment.findUnique({ where: { id: dto.paymentId }, include: { reconciliations: { where: { reversedAt: null } } } }),
            ])
            if (!transaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            if (!payment) throw new NotFoundException('GENERAL_PAYMENT_NOT_FOUND')
            if (transaction.direction !== BankTxnDirection.OUT || transaction.payableAllocations.length) throw new BadRequestException('BANK_TRANSACTION_NOT_AVAILABLE_FOR_GENERAL_RECONCILIATION')
            if (payment.fundingSource !== PaymentFundingSource.OWN_BANK || payment.reconciliations.length) throw new BadRequestException('GENERAL_PAYMENT_NOT_AVAILABLE_FOR_RECONCILIATION')
            if (payment.sourceBankAccountId !== transaction.bankAccountId) throw new BadRequestException('GENERAL_PAYMENT_BANK_ACCOUNT_MISMATCH')
            const allocatedAmount = transaction.generalPaymentReconciliations.reduce((sum, item) => sum.plus(item.payment.amountVnd), new Prisma.Decimal(0))
            const remainingAmount = new Prisma.Decimal(transaction.amount).minus(allocatedAmount)
            if (new Prisma.Decimal(payment.amountVnd).greaterThan(remainingAmount)) throw new BadRequestException('GENERAL_PAYMENT_AMOUNT_EXCEEDS_TRANSACTION_REMAINING')
            const reconciliation = await tx.generalPaymentReconciliation.create({ data: { bankTransactionId, paymentId: payment.id, reconciledById: actorId ?? null, note: dto.note?.trim() || null } })
            await tx.auditLog.create({ data: { moduleCode: 'BANKING', action: 'GENERAL_PAYMENT_RECONCILED', entityId: reconciliation.id, userId: actorId ?? null, method: 'POST', path: `/banking/general-payment-requests/reconciliation/${bankTransactionId}`, statusCode: 200, after: { bankTransactionId, paymentId: payment.id, amountVnd: payment.amountVnd.toString() } } })
            const totalAllocated = allocatedAmount.plus(payment.amountVnd)
            return tx.bankTransaction.update({
                where: { id: bankTransactionId },
                data: { matchStatus: totalAllocated.greaterThanOrEqualTo(transaction.amount) ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED, reconciliationStatus: totalAllocated.greaterThanOrEqualTo(transaction.amount) ? BankTxnReconciliationStatus.ALLOCATED : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED, isConfirmed: true, confirmedAt: new Date(), confirmedBy: actorId ?? null },
            })
        })
    }

    async recentReconciliations() {
        return this.prisma.generalPaymentReconciliation.findMany({
            where: { reversedAt: null },
            include: {
                bankTransaction: { select: { txnDate: true, amount: true, description: true } },
                payment: { include: { paymentRequest: { select: { requestNo: true, beneficiaryName: true } } } },
            },
            orderBy: { reconciledAt: 'desc' },
            take: 30,
        })
    }

    async reverseReconciliation(id: string, dto: ReverseGeneralPaymentReconciliationDto, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            const reconciliation = await tx.generalPaymentReconciliation.findUnique({ where: { id }, include: { bankTransaction: true, payment: true } })
            if (!reconciliation) throw new NotFoundException('GENERAL_PAYMENT_RECONCILIATION_NOT_FOUND')
            if (reconciliation.reversedAt) throw new BadRequestException('GENERAL_PAYMENT_RECONCILIATION_ALREADY_REVERSED')
            const updated = await tx.generalPaymentReconciliation.update({ where: { id }, data: { reversedAt: new Date(), reversedById: actorId ?? null, reversalReason: dto.reason.trim() } })
            const active = await tx.generalPaymentReconciliation.findMany({ where: { bankTransactionId: reconciliation.bankTransactionId, reversedAt: null }, include: { payment: { select: { amountVnd: true } } } })
            const allocatedAmount = active.reduce((sum, item) => sum.plus(item.payment.amountVnd), new Prisma.Decimal(0))
            await tx.bankTransaction.update({
                where: { id: reconciliation.bankTransactionId },
                data: {
                    matchStatus: allocatedAmount.isZero() ? BankTxnMatchStatus.UNMATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                    reconciliationStatus: allocatedAmount.isZero() ? BankTxnReconciliationStatus.PENDING : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED,
                    isConfirmed: !allocatedAmount.isZero(),
                    confirmedAt: allocatedAmount.isZero() ? null : reconciliation.bankTransaction.confirmedAt,
                    confirmedBy: allocatedAmount.isZero() ? null : reconciliation.bankTransaction.confirmedBy,
                },
            })
            await tx.auditLog.create({ data: { moduleCode: 'BANKING', action: 'GENERAL_PAYMENT_RECONCILIATION_REVERSED', entityId: reconciliation.id, userId: actorId ?? null, method: 'POST', path: `/banking/general-payment-requests/reconciliation/${id}/reverse`, statusCode: 200, before: { bankTransactionId: reconciliation.bankTransactionId, paymentId: reconciliation.paymentId, amountVnd: reconciliation.payment.amountVnd.toString() }, after: { reversedAt: updated.reversedAt?.toISOString(), reversalReason: updated.reversalReason } } })
            return updated
        })
    }

    private reconciliationScore(description: string, counterpartyName: string | null, beneficiaryName: string, content: string) {
        const text = `${description} ${counterpartyName ?? ''}`.toLocaleLowerCase('vi')
        const tokens = `${beneficiaryName} ${content}`.toLocaleLowerCase('vi').split(/\s+/).filter((x) => x.length >= 3)
        return tokens.reduce((score, token) => score + (text.includes(token) ? 10 : 0), 50)
    }

    private async find(id: string) {
        const request = await this.prisma.generalPaymentRequest.findUnique({ where: { id } })
        if (!request) throw new NotFoundException('GENERAL_PAYMENT_REQUEST_NOT_FOUND')
        return request
    }
}
