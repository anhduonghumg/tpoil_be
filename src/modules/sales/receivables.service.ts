import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    BankTxnReconciliationStatus,
    PayableOpenItemStatus,
    Prisma,
    ReceivableAllocationStatus,
    ReceivableEntryType,
    ReceivableOpenItemStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    AllocateReceivableDto,
    AllocateBankReceiptDto,
    ListReceivablesQueryDto,
    PartyDebtQueryDto,
} from './dto/receivable.dto'

const openStatuses: ReceivableOpenItemStatus[] = [
    ReceivableOpenItemStatus.OPEN,
    ReceivableOpenItemStatus.PARTIALLY_SETTLED,
]

/**
 * dueDate is a DATE column (midnight). An invoice due today is NOT overdue, so compare
 * against the start of today rather than the current instant.
 */
export function startOfToday() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return today
}

/**
 * Customer receivables — the mirror of the supplier payable ledger (spec v1.2 §3.8, §11).
 *
 * The open item carries the balance, the ledger carries the history: money in, credit notes
 * and reversals are all append-only entries, never edits.
 */
@Injectable()
export class ReceivablesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly events: SalesWorkflowEventsService,
    ) {}

    /**
     * Raises the debt for a delivered commercial document. Idempotent per document, so a
     * retry cannot double-bill. GĐ 6 will call this from invoice issuance and fill
     * salesInvoiceId.
     */
    async openItemForOrder(
        tx: Prisma.TransactionClient,
        args: {
            salesOrderId?: string
            withdrawalRequestId?: string
            salesInvoiceId?: string
            installmentNo?: number
            amount: Prisma.Decimal
            currency: string
            legalEntityId: string
            customerPartyId: string
            dueDate?: Date | null
            note?: string | null
            actorId?: string | null
            effectiveAt?: Date
        },
    ) {
        if (!args.salesOrderId && !args.withdrawalRequestId && !args.salesInvoiceId) {
            throw new BadRequestException({
                code: 'RECEIVABLE_SOURCE_REQUIRED',
                message: 'Khoản phải thu phải gắn với chứng từ nguồn.',
            })
        }
        if (!args.amount.greaterThan(0)) {
            throw new BadRequestException({
                code: 'RECEIVABLE_AMOUNT_INVALID',
                message: 'Số tiền phải thu phải lớn hơn 0.',
            })
        }

        const existing = await tx.receivableOpenItem.findFirst({
            where: {
                status: { not: ReceivableOpenItemStatus.VOIDED },
                ...(args.salesInvoiceId
                    ? {
                          salesInvoiceId: args.salesInvoiceId,
                          installmentNo: args.installmentNo ?? 1,
                      }
                    : args.withdrawalRequestId
                      ? { withdrawalRequestId: args.withdrawalRequestId }
                      : { salesOrderId: args.salesOrderId }),
            },
        })
        if (existing) return existing

        const effectiveAt = args.effectiveAt ?? new Date()
        const openItem = await tx.receivableOpenItem.create({
            data: {
                salesInvoiceId: args.salesInvoiceId ?? null,
                installmentNo: args.installmentNo ?? 1,
                salesOrderId: args.salesOrderId ?? null,
                withdrawalRequestId: args.withdrawalRequestId ?? null,
                legalEntityId: args.legalEntityId,
                customerPartyId: args.customerPartyId,
                currency: args.currency,
                originalAmount: args.amount,
                outstandingAmount: args.amount,
                dueDate: args.dueDate ?? null,
                note: args.note ?? null,
            },
        })
        await tx.receivableLedgerEntry.create({
            data: {
                openItemId: openItem.id,
                type: ReceivableEntryType.OPEN,
                amountDelta: args.amount,
                idempotencyKey: `receivable-open:${openItem.id}`,
                effectiveAt,
            },
        })
        await this.events.record(tx, {
            entityType: 'SALES_ORDER',
            entityId: args.salesOrderId ?? args.withdrawalRequestId ?? openItem.id,
            eventType: 'RECEIVABLE_OPEN',
            actorId: args.actorId ?? null,
            metadata: { openItemId: openItem.id, amount: args.amount.toString() },
        })
        return openItem
    }

    /** Applies money received to an open item. Reversible, never edited in place. */
    async allocate(dto: AllocateReceivableDto, actor: ScopedActor) {
        const amount = new Prisma.Decimal(dto.amount)
        if (!amount.greaterThan(0)) {
            throw new BadRequestException({
                code: 'ALLOCATION_AMOUNT_INVALID',
                message: 'Số tiền phân bổ phải lớn hơn 0.',
            })
        }

        const allocationId = await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receivable:' + dto.openItemId}))`

            const openItem = await tx.receivableOpenItem.findUnique({ where: { id: dto.openItemId } })
            if (!openItem) throw new NotFoundException('RECEIVABLE_OPEN_ITEM_NOT_FOUND')
            if (!openStatuses.includes(openItem.status)) {
                throw new BadRequestException({
                    code: 'RECEIVABLE_NOT_OPEN',
                    message: `Khoản phải thu đang ở trạng thái ${openItem.status}.`,
                })
            }

            const bankTransaction = await tx.bankTransaction.findUnique({
                where: { id: dto.bankTransactionId },
                select: {
                    id: true,
                    direction: true,
                    amount: true,
                    txnDate: true,
                    valueDate: true,
                    counterpartyType: true,
                    bankAccount: { select: { currency: true, legalEntityId: true } },
                },
            })
            if (!bankTransaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            // Money must be coming IN to settle a receivable.
            if (bankTransaction.direction !== BankTxnDirection.IN) {
                throw new BadRequestException({
                    code: 'BANK_TRANSACTION_NOT_INBOUND',
                    message: 'Chỉ giao dịch tiền về mới đối trừ được công nợ phải thu.',
                })
            }
            if (
                bankTransaction.bankAccount.legalEntityId &&
                bankTransaction.bankAccount.legalEntityId !== openItem.legalEntityId
            ) {
                throw new BadRequestException({
                    code: 'BANK_ACCOUNT_LEGAL_ENTITY_MISMATCH',
                    message: 'Tài khoản nhận tiền không thuộc cùng pháp nhân với khoản phải thu.',
                })
            }
            if (bankTransaction.bankAccount.currency !== openItem.currency) {
                throw new BadRequestException({
                    code: 'RECEIVABLE_CURRENCY_MISMATCH',
                    message: 'Loại tiền của giao dịch ngân hàng và khoản phải thu không khớp.',
                })
            }

            if (amount.greaterThan(openItem.outstandingAmount)) {
                throw new BadRequestException({
                    code: 'ALLOCATION_EXCEEDS_OUTSTANDING',
                    message: `Phân bổ ${amount} vượt số còn phải thu ${openItem.outstandingAmount}.`,
                })
            }

            // Never allocate more of a bank receipt than the receipt itself.
            const alreadyAllocated = await tx.receivableAllocation.aggregate({
                where: {
                    bankTransactionId: dto.bankTransactionId,
                    status: ReceivableAllocationStatus.ACTIVE,
                },
                _sum: { amountInBankCurrency: true },
            })
            const usable = new Prisma.Decimal(bankTransaction.amount)
                .abs()
                .minus(alreadyAllocated._sum.amountInBankCurrency ?? 0)
            if (amount.greaterThan(usable)) {
                throw new BadRequestException({
                    code: 'BANK_TRANSACTION_OVER_ALLOCATED',
                    message: `Giao dịch ngân hàng chỉ còn ${usable} chưa phân bổ.`,
                })
            }

            const idempotencyKey =
                dto.idempotencyKey?.trim() ||
                `receivable-alloc:${dto.bankTransactionId}:${dto.openItemId}:${amount.toString()}`
            const duplicate = await tx.receivableAllocation.findUnique({ where: { idempotencyKey } })
            if (duplicate) return duplicate.id

            const allocation = await tx.receivableAllocation.create({
                data: {
                    bankTransactionId: dto.bankTransactionId,
                    openItemId: dto.openItemId,
                    amountInBankCurrency: amount,
                    amountInItemCurrency: amount,
                    fxRate: null,
                    idempotencyKey,
                    allocatedById: actor.userId,
                    effectiveAt: bankTransaction.valueDate ?? bankTransaction.txnDate,
                    allocatedAt: new Date(),
                },
            })
            await tx.receivableLedgerEntry.create({
                data: {
                    openItemId: dto.openItemId,
                    type: ReceivableEntryType.RECEIPT,
                    amountDelta: amount.negated(),
                    allocationId: allocation.id,
                    idempotencyKey: `receivable-receipt:${allocation.id}`,
                        effectiveAt: bankTransaction.valueDate ?? bankTransaction.txnDate,
                },
            })
            const outstandingAmount = new Prisma.Decimal(openItem.outstandingAmount).minus(amount)
            await tx.receivableOpenItem.update({
                where: { id: dto.openItemId },
                data: {
                    outstandingAmount,
                    status: outstandingAmount.isZero()
                        ? ReceivableOpenItemStatus.SETTLED
                        : ReceivableOpenItemStatus.PARTIALLY_SETTLED,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: openItem.salesOrderId ?? openItem.withdrawalRequestId ?? openItem.id,
                eventType: 'RECEIVABLE_RECEIPT',
                actorId: actor.userId,
                metadata: {
                    openItemId: openItem.id,
                    allocationId: allocation.id,
                    amount: amount.toString(),
                },
            })
            return allocation.id
        })

        return this.detail(
            (await this.prisma.receivableAllocation.findUniqueOrThrow({
                where: { id: allocationId },
                select: { openItemId: true },
            })).openItemId,
        )
    }

    /**
     * Confirms a customer receipt in one atomic operation.  This is deliberately
     * separate from import: imported money remains untouched until an accountant
     * chooses the customer debts it settles.
     */
    async allocateBankReceipt(bankTransactionId: string, dto: AllocateBankReceiptDto, actor: ScopedActor) {
        const seen = new Set<string>()
        for (const row of dto.allocations) {
            if (seen.has(row.openItemId)) {
                throw new BadRequestException({
                    code: 'DUPLICATE_RECEIVABLE_ALLOCATION',
                    message: 'Mỗi khoản phải thu chỉ được phân bổ một lần trong cùng thao tác.',
                })
            }
            seen.add(row.openItemId)
        }

        const total = dto.allocations.reduce((sum, row) => sum.plus(new Prisma.Decimal(row.amount)), new Prisma.Decimal(0))
        if (!total.greaterThan(0)) {
            throw new BadRequestException({ code: 'ALLOCATION_AMOUNT_INVALID', message: 'Số tiền phân bổ phải lớn hơn 0.' })
        }

        const batchKey = `receivable-batch:${bankTransactionId}:${dto.allocations
            .slice()
            .sort((a, b) => a.openItemId.localeCompare(b.openItemId))
            .map((row) => `${row.openItemId}:${row.amount}`)
            .join('|')}`
        const allocationKeys = dto.allocations.map((row) => `${batchKey}:${row.openItemId}`)

        return this.prisma.$transaction(async (tx) => {
            const lockKeys = [`bank:${bankTransactionId}`, ...[...seen].map((id) => `receivable:${id}`)].sort()
            for (const key of lockKeys) {
                // pg_advisory_xact_lock returns PostgreSQL `void`.  This is a
                // command used only for serialization, so do not ask Prisma to
                // deserialize its return value through $queryRaw.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
            }

            const bankTransaction = await tx.bankTransaction.findUnique({
                where: { id: bankTransactionId },
                include: {
                    bankAccount: { select: { currency: true, legalEntityId: true } },
                    receivableAllocations: { where: { status: ReceivableAllocationStatus.ACTIVE } },
                },
            })
            if (!bankTransaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            if (bankTransaction.direction !== BankTxnDirection.IN) {
                throw new BadRequestException({
                    code: 'BANK_TRANSACTION_NOT_INBOUND',
                    message: 'Chỉ giao dịch tiền vào mới phân bổ được vào công nợ phải thu.',
                })
            }
            if (bankTransaction.reconciliationStatus === BankTxnReconciliationStatus.IGNORED) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_IGNORED', message: 'Giao dịch này đã được bỏ qua.' })
            }

            const alreadyAllocated = bankTransaction.receivableAllocations.reduce(
                (sum, row) => sum.plus(row.amountInBankCurrency),
                new Prisma.Decimal(0),
            )
            const remaining = new Prisma.Decimal(bankTransaction.amount).abs().minus(alreadyAllocated)
            const existingBatch = await tx.receivableAllocation.findMany({
                where: { idempotencyKey: { in: allocationKeys } },
                select: { id: true },
            })
            if (existingBatch.length === allocationKeys.length) {
                return { bankTransactionId, allocatedAmount: '0', remainingAmount: remaining.toString(), idempotent: true }
            }
            if (existingBatch.length > 0) {
                throw new BadRequestException({
                    code: 'RECEIPT_ALLOCATION_RETRY_CONFLICT',
                    message: 'Giao dịch đối soát đang được xử lý. Hãy làm mới dữ liệu trước khi thao tác lại.',
                })
            }
            if (total.greaterThan(remaining)) {
                throw new BadRequestException({
                    code: 'BANK_TRANSACTION_OVER_ALLOCATED',
                    message: `Giao dịch chỉ còn ${remaining.toString()} chưa phân bổ.`,
                })
            }

            const openItems = await tx.receivableOpenItem.findMany({ where: { id: { in: [...seen] } } })
            if (openItems.length !== seen.size) throw new BadRequestException('RECEIVABLE_OPEN_ITEM_NOT_FOUND')
            const byId = new Map(openItems.map((item) => [item.id, item]))
            const effectiveAt = bankTransaction.valueDate ?? bankTransaction.txnDate
            for (const row of dto.allocations) {
                const openItem = byId.get(row.openItemId)!
                const amount = new Prisma.Decimal(row.amount)
                if (!openStatuses.includes(openItem.status)) {
                    throw new BadRequestException({ code: 'RECEIVABLE_NOT_OPEN', message: `Khoản phải thu ${openItem.id} không còn mở.` })
                }
                if (amount.greaterThan(openItem.outstandingAmount)) {
                    throw new BadRequestException({
                        code: 'ALLOCATION_EXCEEDS_OUTSTANDING',
                        message: `Phân bổ vượt số tiền còn phải thu của khoản ${openItem.id}.`,
                    })
                }
                if (openItem.currency !== bankTransaction.bankAccount.currency) {
                    throw new BadRequestException({ code: 'RECEIVABLE_CURRENCY_MISMATCH', message: 'Loại tiền không khớp.' })
                }
                if (
                    bankTransaction.bankAccount.legalEntityId &&
                    bankTransaction.bankAccount.legalEntityId !== openItem.legalEntityId
                ) {
                    throw new BadRequestException({
                        code: 'BANK_ACCOUNT_LEGAL_ENTITY_MISMATCH',
                        message: 'Tài khoản nhận tiền không thuộc cùng pháp nhân với khoản phải thu.',
                    })
                }

                const idempotencyKey = `${batchKey}:${openItem.id}`
                const allocation = await tx.receivableAllocation.create({
                    data: {
                        bankTransactionId,
                        openItemId: openItem.id,
                        amountInBankCurrency: amount,
                        amountInItemCurrency: amount,
                        fxRate: 1,
                        idempotencyKey,
                        allocatedById: actor.userId,
                        effectiveAt,
                        allocatedAt: new Date(),
                    },
                })
                await tx.receivableLedgerEntry.create({
                    data: {
                        openItemId: openItem.id,
                        type: ReceivableEntryType.RECEIPT,
                        amountDelta: amount.negated(),
                        allocationId: allocation.id,
                        idempotencyKey: `receivable-receipt:${allocation.id}`,
                        effectiveAt,
                    },
                })
                const outstandingAmount = new Prisma.Decimal(openItem.outstandingAmount).minus(amount)
                await tx.receivableOpenItem.update({
                    where: { id: openItem.id },
                    data: {
                        outstandingAmount,
                        status: outstandingAmount.isZero()
                            ? ReceivableOpenItemStatus.SETTLED
                            : ReceivableOpenItemStatus.PARTIALLY_SETTLED,
                        version: { increment: 1 },
                    },
                })
                await this.events.record(tx, {
                    entityType: 'SALES_ORDER',
                    entityId: openItem.salesOrderId ?? openItem.withdrawalRequestId ?? openItem.id,
                    eventType: 'RECEIVABLE_RECEIPT',
                    actorId: actor.userId,
                    metadata: { openItemId: openItem.id, allocationId: allocation.id, amount: amount.toString(), bankTransactionId },
                })
            }

            const finalAllocated = alreadyAllocated.plus(total)
            const fullyAllocated = finalAllocated.greaterThanOrEqualTo(new Prisma.Decimal(bankTransaction.amount).abs())
            await tx.bankTransaction.update({
                where: { id: bankTransactionId },
                data: {
                    matchStatus: fullyAllocated ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                    reconciliationStatus: fullyAllocated
                        ? BankTxnReconciliationStatus.ALLOCATED
                        : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                    confirmedBy: actor.userId,
                    note: dto.note?.trim() || bankTransaction.note,
                },
            })

            return { bankTransactionId, allocatedAmount: total.toString(), remainingAmount: remaining.minus(total).toString() }
        })
    }

    /** Candidate debts for an inbound bank transaction; suggestions never post a receipt. */
    async receiptSuggestions(bankTransactionId: string) {
        const transaction = await this.prisma.bankTransaction.findUnique({
            where: { id: bankTransactionId },
            include: {
                bankAccount: { select: { currency: true, legalEntityId: true } },
                receivableAllocations: { where: { status: ReceivableAllocationStatus.ACTIVE } },
            },
        })
        if (!transaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (transaction.direction !== BankTxnDirection.IN) {
            throw new BadRequestException({ code: 'BANK_TRANSACTION_NOT_INBOUND', message: 'Chỉ gợi ý cho giao dịch tiền vào.' })
        }
        const allocatedAmount = transaction.receivableAllocations.reduce(
            (sum, item) => sum.plus(item.amountInBankCurrency),
            new Prisma.Decimal(0),
        )
        const remainingAmount = new Prisma.Decimal(transaction.amount).abs().minus(allocatedAmount)
        const candidates = await this.prisma.receivableOpenItem.findMany({
            where: {
                status: { in: openStatuses },
                settlementType: 'RECEIVABLE',
                currency: transaction.bankAccount.currency,
                ...(transaction.bankAccount.legalEntityId ? { legalEntityId: transaction.bankAccount.legalEntityId } : {}),
            },
            include: {
                customer: { select: { id: true, code: true, name: true, bankAccounts: { where: { isActive: true }, select: { accountNo: true } } } },
                salesOrder: { select: { id: true, orderNo: true, orderDate: true } },
                salesInvoice: { select: { id: true, invoiceNoInternal: true, misaInvoiceNo: true, dueDate: true } },
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
            take: 100,
        })
        const text = this.normalizeForMatch([transaction.description, transaction.externalRef, transaction.documentCode].filter(Boolean).join(' '))
        const payerAccount = this.normalizeForMatch(transaction.counterpartyAcc ?? '')
        const payerName = this.normalizeForMatch(transaction.counterpartyName ?? '')
        const suggestions = candidates
            .map((item) => {
                let score = 0
                const references = [item.salesOrder?.orderNo, item.salesInvoice?.invoiceNoInternal, item.salesInvoice?.misaInvoiceNo]
                    .filter(Boolean)
                    .map((value) => this.normalizeForMatch(value!))
                if (references.some((reference) => reference && text.includes(reference))) score += 85
                if (transaction.documentCode && references.includes(this.normalizeForMatch(transaction.documentCode))) score += 20
                if (item.customer.bankAccounts.some((account) => this.normalizeForMatch(account.accountNo) === payerAccount)) score += 75
                const customerName = this.normalizeForMatch(item.customer.name)
                if (payerName && (payerName.includes(customerName) || customerName.includes(payerName))) score += 35
                const outstanding = new Prisma.Decimal(item.outstandingAmount)
                if (outstanding.equals(remainingAmount)) score += 20
                else if (outstanding.greaterThanOrEqualTo(remainingAmount)) score += 8
                return {
                    openItemId: item.id,
                    customer: { id: item.customer.id, code: item.customer.code, name: item.customer.name },
                    salesOrder: item.salesOrder,
                    salesInvoice: item.salesInvoice,
                    dueDate: item.dueDate,
                    outstandingAmount: outstanding.toString(),
                    suggestedAmount: (outstanding.lessThan(remainingAmount) ? outstanding : remainingAmount).toString(),
                    score,
                }
            })
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score || String(a.dueDate ?? '').localeCompare(String(b.dueDate ?? '')))
            .slice(0, 20)
        return {
            transaction: {
                id: transaction.id,
                amount: transaction.amount.toString(),
                allocatedAmount: allocatedAmount.toString(),
                remainingAmount: remainingAmount.toString(),
                txnDate: transaction.txnDate,
                valueDate: transaction.valueDate ?? transaction.txnDate,
                description: transaction.description,
                counterpartyName: transaction.counterpartyName,
                counterpartyAcc: transaction.counterpartyAcc,
            },
            suggestions,
        }
    }

    private normalizeForMatch(value: string) {
        return value
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9]/g, '')
            .toUpperCase()
    }

    /** Undoes an allocation with a counter-entry; the original rows stay untouched. */
    async reverseAllocation(allocationId: string, actor: ScopedActor) {
        const openItemId = await this.prisma.$transaction(async (tx) => {
            const allocation = await tx.receivableAllocation.findUnique({
                where: { id: allocationId },
                include: { openItem: true },
            })
            if (!allocation) throw new NotFoundException('RECEIVABLE_ALLOCATION_NOT_FOUND')
            if (allocation.status !== ReceivableAllocationStatus.ACTIVE) {
                throw new BadRequestException({
                    code: 'ALLOCATION_NOT_ACTIVE',
                    message: 'Phân bổ này đã được đảo.',
                })
            }
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receivable:' + allocation.openItemId}))`

            const reversal = await tx.receivableAllocation.create({
                data: {
                    bankTransactionId: allocation.bankTransactionId,
                    openItemId: allocation.openItemId,
                    amountInBankCurrency: allocation.amountInBankCurrency.negated(),
                    amountInItemCurrency: allocation.amountInItemCurrency.negated(),
                    fxRate: allocation.fxRate,
                    status: ReceivableAllocationStatus.REVERSED,
                    reversalOfId: allocation.id,
                    idempotencyKey: `receivable-alloc-reverse:${allocation.id}`,
                    allocatedById: actor.userId,
                    allocatedAt: new Date(),
                },
            })
            await tx.receivableAllocation.update({
                where: { id: allocation.id },
                data: { status: ReceivableAllocationStatus.REVERSED },
            })

            const originalEntry = await tx.receivableLedgerEntry.findFirst({
                where: { allocationId: allocation.id },
            })
            await tx.receivableLedgerEntry.create({
                data: {
                    openItemId: allocation.openItemId,
                    type: ReceivableEntryType.REVERSAL,
                    amountDelta: allocation.amountInItemCurrency,
                    allocationId: reversal.id,
                    reversalOfId: originalEntry?.id ?? null,
                    idempotencyKey: `receivable-reverse:${allocation.id}`,
                    effectiveAt: new Date(),
                },
            })

            const outstandingAmount = new Prisma.Decimal(allocation.openItem.outstandingAmount).plus(
                allocation.amountInItemCurrency,
            )
            await tx.receivableOpenItem.update({
                where: { id: allocation.openItemId },
                data: {
                    outstandingAmount,
                    status: outstandingAmount.equals(allocation.openItem.originalAmount)
                        ? ReceivableOpenItemStatus.OPEN
                        : ReceivableOpenItemStatus.PARTIALLY_SETTLED,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId:
                    allocation.openItem.salesOrderId ??
                    allocation.openItem.withdrawalRequestId ??
                    allocation.openItemId,
                eventType: 'RECEIVABLE_RECEIPT_REVERSED',
                actorId: actor.userId,
                metadata: { allocationId: allocation.id },
            })
            return allocation.openItemId
        })
        return this.detail(openItemId)
    }

    async detail(openItemId: string) {
        const item = await this.prisma.receivableOpenItem.findUnique({
            where: { id: openItemId },
            include: {
                customer: { select: { id: true, code: true, name: true, taxCode: true } },
                salesOrder: { select: { id: true, orderNo: true, orderDate: true } },
                withdrawalRequest: { select: { id: true, requestNo: true, requestDate: true } },
                entries: { orderBy: { effectiveAt: 'asc' } },
                allocations: {
                    orderBy: { allocatedAt: 'desc' },
                    include: {
                        bankTransaction: {
                            select: { id: true, txnDate: true, amount: true, description: true },
                        },
                    },
                },
            },
        })
        if (!item) throw new NotFoundException('RECEIVABLE_OPEN_ITEM_NOT_FOUND')
        return { ...item, ...this.ageOf(item) }
    }

    private ageOf(item: { dueDate: Date | null; outstandingAmount: Prisma.Decimal; status: ReceivableOpenItemStatus }) {
        const overdueDays =
            item.dueDate && item.status !== ReceivableOpenItemStatus.SETTLED
                ? Math.floor((startOfToday().getTime() - item.dueDate.getTime()) / 86_400_000)
                : 0
        return {
            isOverdue: overdueDays > 0 && new Prisma.Decimal(item.outstandingAmount).greaterThan(0),
            overdueDays: Math.max(overdueDays, 0),
        }
    }

    async list(query: ListReceivablesQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const where: Prisma.ReceivableOpenItemWhereInput = {
            customerPartyId: query.customerPartyId ?? undefined,
            status: query.status
                ? (query.status as ReceivableOpenItemStatus)
                : query.onlyOpen
                  ? { in: openStatuses }
                  : undefined,
            ...(query.overdueOnly
                ? { dueDate: { lt: startOfToday() }, status: { in: openStatuses } }
                : {}),
        }
        const [rows, total, totals] = await this.prisma.$transaction([
            this.prisma.receivableOpenItem.findMany({
                where,
                include: {
                    customer: { select: { id: true, code: true, name: true } },
                    salesOrder: { select: { id: true, orderNo: true } },
                    withdrawalRequest: { select: { id: true, requestNo: true } },
                },
                orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.receivableOpenItem.count({ where }),
            this.prisma.receivableOpenItem.aggregate({
                where,
                _sum: { originalAmount: true, outstandingAmount: true },
            }),
        ])
        return {
            items: rows.map((row) => ({ ...row, ...this.ageOf(row) })),
            total,
            page,
            limit,
            totals: {
                originalAmount: (totals._sum.originalAmount ?? new Prisma.Decimal(0)).toString(),
                outstandingAmount: (totals._sum.outstandingAmount ?? new Prisma.Decimal(0)).toString(),
            },
        }
    }

    /** Total a customer still owes — feeds the credit check and the customer overview. */
    async customerBalance(customerPartyId: string) {
        const items = await this.prisma.receivableOpenItem.findMany({
            where: { customerPartyId, status: { in: openStatuses }, settlementType: 'RECEIVABLE' },
            select: { outstandingAmount: true, dueDate: true },
        })
        const now = startOfToday()
        let outstanding = new Prisma.Decimal(0)
        let overdue = new Prisma.Decimal(0)
        for (const item of items) {
            outstanding = outstanding.plus(item.outstandingAmount)
            if (item.dueDate && item.dueDate < now) overdue = overdue.plus(item.outstandingAmount)
        }
        return {
            openItems: items.length,
            outstandingAmount: outstanding.toString(),
            overdueAmount: overdue.toString(),
            hasOverdue: overdue.greaterThan(0),
        }
    }

    /** Aging buckets for the AR report. */
    private bucketOf(dueDate: Date | null, asOf: Date) {
        if (!dueDate) return 'NO_DUE_DATE'
        const days = Math.floor((asOf.getTime() - dueDate.getTime()) / 86_400_000)
        if (days <= 0) return 'CURRENT'
        if (days <= 30) return 'D1_30'
        if (days <= 60) return 'D31_60'
        if (days <= 90) return 'D61_90'
        return 'D90_PLUS'
    }

    async aging(customerPartyId?: string, asOfText?: string) {
        const asOfDay = asOfText ? new Date(`${asOfText}T00:00:00`) : startOfToday()
        if (Number.isNaN(asOfDay.getTime())) {
            throw new BadRequestException({ code: 'AGING_AS_OF_INVALID', message: 'Ngày báo cáo không hợp lệ.' })
        }
        const asOfEnd = new Date(asOfDay)
        asOfEnd.setHours(23, 59, 59, 999)
        const items = await this.prisma.receivableOpenItem.findMany({
            where: {
                customerPartyId: customerPartyId ?? undefined,
                settlementType: 'RECEIVABLE',
            },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                entries: { where: { effectiveAt: { lte: asOfEnd } }, select: { amountDelta: true } },
            },
        })
        const byCustomer = new Map<string, Record<string, Prisma.Decimal> & { customer: any }>()
        for (const item of items) {
            // Current outstandingAmount cannot be used for a historical report:
            // payments made after the report date must still appear as outstanding.
            const balanceAtAsOf = item.entries.reduce((sum, entry) => sum.plus(entry.amountDelta), new Prisma.Decimal(0))
            if (!balanceAtAsOf.greaterThan(0)) continue
            const key = item.customerPartyId
            const row =
                byCustomer.get(key) ??
                ({
                    customer: item.customer,
                    CURRENT: new Prisma.Decimal(0),
                    D1_30: new Prisma.Decimal(0),
                    D31_60: new Prisma.Decimal(0),
                    D61_90: new Prisma.Decimal(0),
                    D90_PLUS: new Prisma.Decimal(0),
                    NO_DUE_DATE: new Prisma.Decimal(0),
                    total: new Prisma.Decimal(0),
                } as any)
            const bucket = this.bucketOf(item.dueDate, asOfDay)
            row[bucket] = row[bucket].plus(balanceAtAsOf)
            row.total = row.total.plus(balanceAtAsOf)
            byCustomer.set(key, row)
        }
        return {
            asOf: asOfDay.toISOString().slice(0, 10),
            items: [...byCustomer.values()].map((row) => ({
                customer: row.customer,
                CURRENT: row.CURRENT.toString(),
                D1_30: row.D1_30.toString(),
                D31_60: row.D31_60.toString(),
                D61_90: row.D61_90.toString(),
                D90_PLUS: row.D90_PLUS.toString(),
                NO_DUE_DATE: row.NO_DUE_DATE.toString(),
                total: row.total.toString(),
            })),
        }
    }

    /**
     * Collection KPIs deliberately use allocation.effectiveAt (the bank value time).
     * Therefore late Excel imports are attributed to the day cash was actually received,
     * and no employee is rewarded twice when one receipt covers many invoices.
     */
    async collectionKpis(fromDateText?: string, toDateText?: string) {
        const now = new Date()
        const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1)
        const fromDate = fromDateText ? new Date(`${fromDateText}T00:00:00`) : defaultFrom
        const toDate = toDateText ? new Date(`${toDateText}T23:59:59.999`) : now
        if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime()) || fromDate > toDate) {
            throw new BadRequestException({ code: 'KPI_PERIOD_INVALID', message: 'Khoảng thời gian KPI không hợp lệ.' })
        }
        const [allocations, openItems] = await Promise.all([
            this.prisma.receivableAllocation.findMany({
                where: { status: ReceivableAllocationStatus.ACTIVE, effectiveAt: { gte: fromDate, lte: toDate } },
                include: {
                    openItem: {
                        include: {
                            salesOrder: { include: { salesOwner: { select: { id: true, code: true, fullName: true } } } },
                            salesInvoice: { include: { accountantEmployee: { select: { id: true, code: true, fullName: true } } } },
                        },
                    },
                },
            }),
            this.prisma.receivableOpenItem.findMany({
                where: { status: { in: openStatuses }, settlementType: 'RECEIVABLE' },
                include: {
                    salesOrder: { include: { salesOwner: { select: { id: true, code: true, fullName: true } } } },
                    salesInvoice: { include: { accountantEmployee: { select: { id: true, code: true, fullName: true } } } },
                },
            }),
        ])
        type OwnerRow = { owner: { id: string; code: string; fullName: string | null }; collected: Prisma.Decimal; overdueOutstanding: Prisma.Decimal }
        const sales = new Map<string, OwnerRow>()
        const accountants = new Map<string, OwnerRow>()
        const add = (map: Map<string, OwnerRow>, owner: any, field: 'collected' | 'overdueOutstanding', amount: Prisma.Decimal) => {
            if (!owner) return
            const row = map.get(owner.id) ?? { owner, collected: new Prisma.Decimal(0), overdueOutstanding: new Prisma.Decimal(0) }
            row[field] = row[field].plus(amount)
            map.set(owner.id, row)
        }
        for (const allocation of allocations) {
            const amount = new Prisma.Decimal(allocation.amountInItemCurrency)
            add(sales, allocation.openItem.salesOrder?.salesOwner, 'collected', amount)
            add(accountants, allocation.openItem.salesInvoice?.accountantEmployee, 'collected', amount)
        }
        const today = startOfToday()
        for (const item of openItems) {
            if (!item.dueDate || item.dueDate >= today) continue
            const amount = new Prisma.Decimal(item.outstandingAmount)
            add(sales, item.salesOrder?.salesOwner, 'overdueOutstanding', amount)
            add(accountants, item.salesInvoice?.accountantEmployee, 'overdueOutstanding', amount)
        }
        const serialize = (map: Map<string, OwnerRow>) =>
            [...map.values()]
                .map((row) => ({
                    owner: row.owner,
                    collectedAmount: row.collected.toString(),
                    overdueOutstandingAmount: row.overdueOutstanding.toString(),
                }))
                .sort((a, b) => Number(b.collectedAmount) - Number(a.collectedAmount))
        const totalCollected = allocations.reduce((sum, row) => sum.plus(row.amountInItemCurrency), new Prisma.Decimal(0))
        const totalOutstanding = openItems.reduce((sum, row) => sum.plus(row.outstandingAmount), new Prisma.Decimal(0))
        const totalOverdue = openItems
            .filter((item) => item.dueDate && item.dueDate < today)
            .reduce((sum, row) => sum.plus(row.outstandingAmount), new Prisma.Decimal(0))
        return {
            fromDate: fromDate.toISOString().slice(0, 10),
            toDate: toDate.toISOString().slice(0, 10),
            totals: {
                collectedAmount: totalCollected.toString(),
                outstandingAmount: totalOutstanding.toString(),
                overdueOutstandingAmount: totalOverdue.toString(),
            },
            bySalesOwner: serialize(sales),
            byAccountant: serialize(accountants),
        }
    }

    /**
     * Both sides of a party's balance in one place: what they owe us (receivable) and what
     * we owe them (payable) — the same party can be customer and supplier.
     */
    async partyDebt(query: PartyDebtQueryDto) {
        const [receivables, payables] = await Promise.all([
            this.prisma.receivableOpenItem.findMany({
                where: {
                    customerPartyId: query.partyId ?? undefined,
                    status: { in: openStatuses },
                },
                include: { customer: { select: { id: true, code: true, name: true } } },
            }),
            this.prisma.payableOpenItem.findMany({
                where: {
                    supplierPartyId: query.partyId ?? undefined,
                    status: {
                        in: [PayableOpenItemStatus.OPEN, PayableOpenItemStatus.PARTIALLY_SETTLED],
                    },
                },
                include: { supplier: { select: { id: true, code: true, name: true } } },
            }),
        ])

        const byParty = new Map<
            string,
            {
                party: { id: string; code: string; name: string }
                receivableOutstanding: Prisma.Decimal
                receivableOverdue: Prisma.Decimal
                payableOutstanding: Prisma.Decimal
                payableOverdue: Prisma.Decimal
            }
        >()
        const now = startOfToday()
        const ensure = (party: { id: string; code: string; name: string }) => {
            const current = byParty.get(party.id) ?? {
                party,
                receivableOutstanding: new Prisma.Decimal(0),
                receivableOverdue: new Prisma.Decimal(0),
                payableOutstanding: new Prisma.Decimal(0),
                payableOverdue: new Prisma.Decimal(0),
            }
            byParty.set(party.id, current)
            return current
        }
        for (const item of receivables) {
            const row = ensure(item.customer)
            row.receivableOutstanding = row.receivableOutstanding.plus(item.outstandingAmount)
            if (item.dueDate && item.dueDate < now) {
                row.receivableOverdue = row.receivableOverdue.plus(item.outstandingAmount)
            }
        }
        for (const item of payables) {
            const row = ensure(item.supplier)
            row.payableOutstanding = row.payableOutstanding.plus(item.outstandingAmount)
            if (item.dueDate && item.dueDate < now) {
                row.payableOverdue = row.payableOverdue.plus(item.outstandingAmount)
            }
        }

        return [...byParty.values()].map((row) => ({
            party: row.party,
            receivableOutstanding: row.receivableOutstanding.toString(),
            receivableOverdue: row.receivableOverdue.toString(),
            payableOutstanding: row.payableOutstanding.toString(),
            payableOverdue: row.payableOverdue.toString(),
            // Positive means the party owes us on balance.
            netPosition: row.receivableOutstanding.minus(row.payableOutstanding).toString(),
        }))
    }
}
