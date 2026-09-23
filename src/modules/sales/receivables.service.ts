import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    BankTxnReconciliationStatus,
    CollectionPlanStatus,
    CustomerReceiptStatus,
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
    CarryForwardCollectionPlanDto,
    CreateCollectionPlanDto,
    CreateCustomerReceiptDto,
    CreditManagementQueryDto,
    ListCollectionPlansQueryDto,
    ListCustomerReceiptsQueryDto,
    ListReceivablesQueryDto,
    PartyDebtQueryDto,
    BankReceiptFifoItemDto,
    PostBankReceiptsFifoDto,
    ReverseReceiptDto,
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
    /**
     * Đảo một bút phân bổ. Bút thuộc một khoản thu FIFO thì đảo cả khoản thu: FIFO trải tiền ra
     * nhiều khoản phải thu, đảo lẻ một bút sẽ để khoản thu trừ dở mà không ghi nhận lại được.
     */
    async reverseAllocation(allocationId: string, actor: ScopedActor, dto: ReverseReceiptDto = {}) {
        const found = await this.prisma.receivableAllocation.findUnique({
            where: { id: allocationId },
            select: { customerReceiptId: true, openItemId: true },
        })
        if (!found) throw new NotFoundException('RECEIVABLE_ALLOCATION_NOT_FOUND')
        if (found.customerReceiptId) {
            await this.reverseCustomerReceipt(found.customerReceiptId, dto, actor)
            return this.detail(found.openItemId)
        }
        await this.prisma.$transaction(async (tx) => {
            const allocation = await tx.receivableAllocation.findUnique({ where: { id: allocationId }, include: { openItem: true } })
            if (!allocation) throw new NotFoundException('RECEIVABLE_ALLOCATION_NOT_FOUND')
            if (allocation.bankTransactionId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bank:' + allocation.bankTransactionId}))`
            await this.reverseAllocationInTx(tx, allocation, actor, dto.mode ?? 'CORRECTION')
            if (allocation.bankTransactionId) await this.syncBankTransactionAfterReversal(tx, allocation.bankTransactionId)
        })
        return this.detail(found.openItemId)
    }

    /**
     * Đảo cả một khoản thu, đồng bộ mọi thứ phụ thuộc trong một giao dịch:
     *   bút phân bổ + sổ công nợ → khoản thu REVERSED → gỡ khỏi dòng sao kê, trả dòng về hàng
     *   đợi → mở lại kế hoạch thu nếu tiền đã thu không còn đủ.
     */
    async reverseCustomerReceipt(id: string, dto: ReverseReceiptDto, actor: ScopedActor) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer-receipt:' + id}))`
            const receipt = await tx.customerReceipt.findUnique({
                where: { id },
                include: { allocations: { where: { status: ReceivableAllocationStatus.ACTIVE }, include: { openItem: true } } },
            })
            if (!receipt) throw new NotFoundException('CUSTOMER_RECEIPT_NOT_FOUND')
            if (receipt.status === CustomerReceiptStatus.REVERSED) {
                throw new BadRequestException({ code: 'CUSTOMER_RECEIPT_ALREADY_REVERSED', message: 'Khoản thu này đã được đảo.' })
            }
            if (receipt.bankTransactionId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bank:' + receipt.bankTransactionId}))`

            for (const allocation of receipt.allocations) {
                await this.reverseAllocationInTx(tx, allocation, actor, dto.mode ?? 'CORRECTION')
            }
            const reason = dto.reason?.trim() || 'Đảo khoản thu'
            await tx.customerReceipt.update({
                where: { id },
                data: {
                    status: CustomerReceiptStatus.REVERSED,
                    reversedAt: new Date(),
                    reversedById: actor.userId,
                    // Mỗi dòng sao kê chỉ gắn được một khoản thu: gỡ ra để dòng đó ghi nhận lại được.
                    bankTransactionId: null,
                    note: [receipt.note, `[Đảo ${new Date().toLocaleDateString('vi-VN')}] ${reason}`].filter(Boolean).join('\n'),
                },
            })
            if (receipt.bankTransactionId) await this.syncBankTransactionAfterReversal(tx, receipt.bankTransactionId)
            await this.reopenCollectionPlan(tx, receipt.collectionPlanId)
            return { id, status: CustomerReceiptStatus.REVERSED, reversedAllocations: receipt.allocations.length, bankTransactionId: receipt.bankTransactionId }
        })
    }

    /** Nút "Đảo ghi nhận" trên dòng sao kê: đảo khoản thu FIFO, hoặc mọi bút phân bổ tay của dòng. */
    async reverseBankReceipt(bankTransactionId: string, dto: ReverseReceiptDto, actor: ScopedActor) {
        const bankTransaction = await this.prisma.bankTransaction.findUnique({
            where: { id: bankTransactionId },
            select: { id: true, customerReceipt: { select: { id: true } } },
        })
        if (!bankTransaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (bankTransaction.customerReceipt) return this.reverseCustomerReceipt(bankTransaction.customerReceipt.id, dto, actor)

        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bank:' + bankTransactionId}))`
            const allocations = await tx.receivableAllocation.findMany({
                where: { bankTransactionId, status: ReceivableAllocationStatus.ACTIVE },
                include: { openItem: true },
            })
            if (!allocations.length) {
                throw new BadRequestException({ code: 'NOTHING_TO_REVERSE', message: 'Giao dịch này chưa được ghi nhận vào công nợ.' })
            }
            for (const allocation of allocations) await this.reverseAllocationInTx(tx, allocation, actor, dto.mode ?? 'CORRECTION')
            await this.syncBankTransactionAfterReversal(tx, bankTransactionId)
            return { bankTransactionId, reversedAllocations: allocations.length }
        })
    }

    /**
     * Một bút đảo: bút phân bổ âm, bút sổ REVERSAL, trả số dư khoản phải thu.
     *   - CORRECTION: lấy ngày của bút gốc → sổ và lãi công nợ như chưa từng ghi nhầm.
     *   - BANK_REVERSAL: lấy ngày hôm nay → khoảng giữa công ty đã thật sự cầm tiền.
     */
    private async reverseAllocationInTx(
        tx: Prisma.TransactionClient,
        allocation: Prisma.ReceivableAllocationGetPayload<{ include: { openItem: true } }>,
        actor: ScopedActor,
        mode: 'CORRECTION' | 'BANK_REVERSAL',
    ) {
        if (allocation.status !== ReceivableAllocationStatus.ACTIVE) {
            throw new BadRequestException({ code: 'ALLOCATION_NOT_ACTIVE', message: 'Phân bổ này đã được đảo.' })
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receivable:' + allocation.openItemId}))`
        const openItem = await tx.receivableOpenItem.findUniqueOrThrow({ where: { id: allocation.openItemId } })
        const effectiveAt = mode === 'CORRECTION' ? (allocation.effectiveAt ?? allocation.allocatedAt) : new Date()

        const reversal = await tx.receivableAllocation.create({
            data: {
                bankTransactionId: allocation.bankTransactionId,
                customerReceiptId: allocation.customerReceiptId,
                openItemId: allocation.openItemId,
                amountInBankCurrency: allocation.amountInBankCurrency.negated(),
                amountInItemCurrency: allocation.amountInItemCurrency.negated(),
                fxRate: allocation.fxRate,
                status: ReceivableAllocationStatus.REVERSED,
                reversalOfId: allocation.id,
                idempotencyKey: `receivable-alloc-reverse:${allocation.id}`,
                allocatedById: actor.userId,
                effectiveAt,
                allocatedAt: new Date(),
            },
        })
        await tx.receivableAllocation.update({
            where: { id: allocation.id },
            data: {
                status: ReceivableAllocationStatus.REVERSED,
                // Giải phóng khóa chống trùng: không thì phân bổ lại đúng như cũ sẽ bị coi là
                // "đã xử lý rồi" và bỏ qua mà không ghi gì.
                idempotencyKey: `${allocation.idempotencyKey}#reversed`,
            },
        })

        const originalEntry = await tx.receivableLedgerEntry.findFirst({ where: { allocationId: allocation.id } })
        await tx.receivableLedgerEntry.create({
            data: {
                openItemId: allocation.openItemId,
                type: ReceivableEntryType.REVERSAL,
                amountDelta: allocation.amountInItemCurrency,
                allocationId: reversal.id,
                reversalOfId: originalEntry?.id ?? null,
                idempotencyKey: `receivable-reverse:${allocation.id}`,
                effectiveAt,
            },
        })

        const outstandingAmount = new Prisma.Decimal(openItem.outstandingAmount).plus(allocation.amountInItemCurrency)
        await tx.receivableOpenItem.update({
            where: { id: allocation.openItemId },
            data: {
                outstandingAmount,
                status: outstandingAmount.greaterThanOrEqualTo(openItem.originalAmount)
                    ? ReceivableOpenItemStatus.OPEN
                    : ReceivableOpenItemStatus.PARTIALLY_SETTLED,
                version: { increment: 1 },
            },
        })
        await this.events.record(tx, {
            entityType: 'SALES_ORDER',
            entityId: openItem.salesOrderId ?? openItem.withdrawalRequestId ?? allocation.openItemId,
            eventType: 'RECEIVABLE_RECEIPT_REVERSED',
            actorId: actor.userId,
            metadata: { allocationId: allocation.id, mode, customerReceiptId: allocation.customerReceiptId },
        })
    }

    /** Trạng thái dòng sao kê theo số tiền còn phân bổ sau khi đảo; hết thì trả về hàng đợi. */
    private async syncBankTransactionAfterReversal(tx: Prisma.TransactionClient, bankTransactionId: string) {
        const [transaction, active] = await Promise.all([
            tx.bankTransaction.findUniqueOrThrow({ where: { id: bankTransactionId }, select: { amount: true, customerReceipt: { select: { id: true } } } }),
            tx.receivableAllocation.aggregate({
                where: { bankTransactionId, status: ReceivableAllocationStatus.ACTIVE },
                _sum: { amountInBankCurrency: true },
            }),
        ])
        const allocated = new Prisma.Decimal(active._sum.amountInBankCurrency ?? 0)
        if (allocated.isZero() && !transaction.customerReceipt) {
            await tx.bankTransaction.update({
                where: { id: bankTransactionId },
                data: {
                    matchStatus: BankTxnMatchStatus.UNMATCHED,
                    reconciliationStatus: BankTxnReconciliationStatus.PENDING,
                    isConfirmed: false,
                    confirmedAt: null,
                    confirmedBy: null,
                    counterpartyType: null,
                    counterpartyId: null,
                },
            })
            return
        }
        const full = allocated.greaterThanOrEqualTo(new Prisma.Decimal(transaction.amount).abs())
        await tx.bankTransaction.update({
            where: { id: bankTransactionId },
            data: {
                matchStatus: full ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                reconciliationStatus: full ? BankTxnReconciliationStatus.ALLOCATED : BankTxnReconciliationStatus.PARTIALLY_ALLOCATED,
            },
        })
    }

    /** Kế hoạch đã "hoàn thành" mà tiền thu không còn đủ (do đảo) thì quay lại đang theo dõi. */
    private async reopenCollectionPlan(tx: Prisma.TransactionClient, planId: string | null) {
        if (!planId) return
        const plan = await tx.customerCollectionPlan.findUnique({
            where: { id: planId },
            include: { receipts: { select: { amount: true, status: true } } },
        })
        if (!plan || plan.status !== CollectionPlanStatus.COMPLETED) return
        if (this.receiptTotal(plan.receipts).lessThan(new Prisma.Decimal(plan.plannedAmount))) {
            await tx.customerCollectionPlan.update({ where: { id: planId }, data: { status: CollectionPlanStatus.ACTIVE, completedAt: null } })
        }
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
            // Lọc theo kế toán phụ trách khách (Party.accountingOwnerEmpId).
            ...(query.accountingOwnerEmpId ? { customer: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
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
            asOf: this.dayKey(asOfDay),
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
            fromDate: this.dayKey(fromDate),
            toDate: this.dayKey(toDate),
            totals: {
                collectedAmount: totalCollected.toString(),
                outstandingAmount: totalOutstanding.toString(),
                overdueOutstandingAmount: totalOverdue.toString(),
            },
            bySalesOwner: serialize(sales),
            byAccountant: serialize(accountants),
        }
    }

    private period(fromDateText?: string, toDateText?: string) {
        const today = startOfToday()
        const from = fromDateText ? new Date(`${fromDateText}T00:00:00`) : today
        const toDay = toDateText ? new Date(`${toDateText}T00:00:00`) : today
        if (Number.isNaN(from.getTime()) || Number.isNaN(toDay.getTime()) || from > toDay) {
            throw new BadRequestException({ code: 'REPORT_PERIOD_INVALID', message: 'Khoảng thời gian báo cáo không hợp lệ.' })
        }
        const to = new Date(toDay)
        to.setHours(23, 59, 59, 999)
        // Mốc from/to dựng theo giờ địa phương (đã cố định là giờ VN), nên chuỗi ngày cũng phải đọc
        // theo giờ địa phương — toISOString lấy ngày UTC, dưới múi +7 sẽ lùi mất một ngày.
        return { from, to, fromText: this.dayKey(from), toText: this.dayKey(toDay) }
    }

    private receiptTotal(receipts: Array<{ amount: Prisma.Decimal; status: CustomerReceiptStatus }>) {
        return receipts
            .filter((receipt) => receipt.status === CustomerReceiptStatus.CONFIRMED || receipt.status === CustomerReceiptStatus.RECONCILED)
            .reduce((sum, receipt) => sum.plus(receipt.amount), new Prisma.Decimal(0))
    }

    private collectionPlanView(plan: any) {
        const actualAmount = this.receiptTotal(plan.receipts ?? [])
        const plannedAmount = new Prisma.Decimal(plan.plannedAmount)
        const completedAmount = Prisma.Decimal.min(actualAmount, plannedAmount)
        return {
            ...plan,
            plannedAmount: plannedAmount.toString(),
            actualAmount: actualAmount.toString(),
            remainingAmount: Prisma.Decimal.max(plannedAmount.minus(actualAmount), 0).toString(),
            excessAmount: Prisma.Decimal.max(actualAmount.minus(plannedAmount), 0).toString(),
            completionRate: plannedAmount.isZero() ? null : completedAmount.div(plannedAmount).mul(100).toDecimalPlaces(2).toString(),
        }
    }

    async collectionPlans(query: ListCollectionPlansQueryDto) {
        const { from, to } = this.period(query.fromDate, query.toDate)
        const plans = await this.prisma.customerCollectionPlan.findMany({
            where: {
                customerPartyId: query.customerPartyId ?? undefined,
                plannedDate: { gte: from, lte: to },
                status: query.status ?? undefined,
            },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                receipts: { select: { id: true, amount: true, status: true, receivedAt: true } },
            },
            orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
        })
        return { fromDate: this.dayKey(from), toDate: this.dayKey(to), items: plans.map((plan) => this.collectionPlanView(plan)) }
    }

    async createCollectionPlan(dto: CreateCollectionPlanDto, actor: ScopedActor) {
        const plannedDate = new Date(`${dto.plannedDate}T00:00:00`)
        if (Number.isNaN(plannedDate.getTime())) throw new BadRequestException('COLLECTION_PLAN_DATE_INVALID')
        const customer = await this.prisma.party.findUnique({ where: { id: dto.customerPartyId }, select: { id: true } })
        if (!customer) throw new NotFoundException('CUSTOMER_NOT_FOUND')
        return this.prisma.customerCollectionPlan.create({
            data: {
                customerPartyId: dto.customerPartyId,
                plannedDate,
                plannedAmount: new Prisma.Decimal(dto.plannedAmount),
                confirmationNote: dto.confirmationNote?.trim() || null,
                note: dto.note?.trim() || null,
                createdById: actor.userId,
            },
        })
    }

    async carryForwardCollectionPlan(id: string, dto: CarryForwardCollectionPlanDto, actor: ScopedActor) {
        const plannedDate = new Date(`${dto.plannedDate}T00:00:00`)
        if (Number.isNaN(plannedDate.getTime())) throw new BadRequestException('COLLECTION_PLAN_DATE_INVALID')
        return this.prisma.$transaction(async (tx) => {
            const plan = await tx.customerCollectionPlan.findUnique({
                where: { id },
                include: { receipts: { select: { amount: true, status: true } } },
            })
            if (!plan) throw new NotFoundException('COLLECTION_PLAN_NOT_FOUND')
            if (plan.status !== CollectionPlanStatus.ACTIVE) {
                throw new BadRequestException({ code: 'COLLECTION_PLAN_NOT_ACTIVE', message: 'Chỉ kế hoạch đang theo dõi mới được hẹn lại.' })
            }
            const remaining = new Prisma.Decimal(plan.plannedAmount).minus(this.receiptTotal(plan.receipts))
            const amount = new Prisma.Decimal(dto.amount ?? remaining)
            if (!remaining.greaterThan(0) || !amount.greaterThan(0) || !amount.equals(remaining)) {
                throw new BadRequestException({ code: 'COLLECTION_PLAN_CARRY_AMOUNT_INVALID', message: 'Số tiền hẹn lại phải bằng đúng phần còn thiếu để không làm mất kế hoạch cũ.' })
            }
            await tx.customerCollectionPlan.update({ where: { id }, data: { status: CollectionPlanStatus.CARRIED_FORWARD } })
            return tx.customerCollectionPlan.create({
                data: {
                    customerPartyId: plan.customerPartyId,
                    plannedDate,
                    plannedAmount: amount,
                    status: CollectionPlanStatus.ACTIVE,
                    parentPlanId: id,
                    confirmationNote: dto.confirmationNote?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdById: actor.userId,
                },
            })
        })
    }

    async customerReceipts(query: ListCustomerReceiptsQueryDto) {
        const { from, to } = this.period(query.fromDate, query.toDate)
        return this.prisma.customerReceipt.findMany({
            where: {
                customerPartyId: query.customerPartyId ?? undefined,
                status: query.status ?? undefined,
                receivedAt: { gte: from, lte: to },
            },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                collectionPlan: { select: { id: true, plannedDate: true, plannedAmount: true } },
                bankTransaction: { select: { id: true, txnDate: true, valueDate: true, description: true } },
                allocations: { where: { status: ReceivableAllocationStatus.ACTIVE }, select: { amountInItemCurrency: true } },
            },
            orderBy: [{ receivedAt: 'desc' }, { createdAt: 'desc' }],
        })
    }

    async createCustomerReceipt(dto: CreateCustomerReceiptDto, actor: ScopedActor) {
        const receivedAt = new Date(dto.receivedAt)
        if (Number.isNaN(receivedAt.getTime())) throw new BadRequestException('CUSTOMER_RECEIPT_DATE_INVALID')
        const customer = await this.prisma.party.findUnique({ where: { id: dto.customerPartyId }, select: { id: true } })
        if (!customer) throw new NotFoundException('CUSTOMER_NOT_FOUND')
        if (dto.collectionPlanId) {
            const plan = await this.prisma.customerCollectionPlan.findUnique({ where: { id: dto.collectionPlanId }, select: { customerPartyId: true } })
            if (!plan) throw new NotFoundException('COLLECTION_PLAN_NOT_FOUND')
            if (plan.customerPartyId !== dto.customerPartyId) {
                throw new BadRequestException({ code: 'COLLECTION_PLAN_CUSTOMER_MISMATCH', message: 'Kế hoạch thu không thuộc khách hàng này.' })
            }
        }
        return this.prisma.customerReceipt.create({
            data: {
                customerPartyId: dto.customerPartyId,
                collectionPlanId: dto.collectionPlanId ?? null,
                amount: new Prisma.Decimal(dto.amount),
                currency: (dto.currency ?? 'VND').toUpperCase(),
                receivedAt,
                transferReference: dto.transferReference?.trim() || null,
                evidenceReference: dto.evidenceReference?.trim() || null,
                note: dto.note?.trim() || null,
                reportedById: actor.userId,
            },
        })
    }

    private async refreshCollectionPlan(tx: Prisma.TransactionClient, planId: string | null) {
        if (!planId) return
        const plan = await tx.customerCollectionPlan.findUnique({
            where: { id: planId },
            include: { receipts: { select: { amount: true, status: true } } },
        })
        if (!plan || plan.status !== CollectionPlanStatus.ACTIVE) return
        if (this.receiptTotal(plan.receipts).greaterThanOrEqualTo(new Prisma.Decimal(plan.plannedAmount))) {
            await tx.customerCollectionPlan.update({ where: { id: planId }, data: { status: CollectionPlanStatus.COMPLETED, completedAt: new Date() } })
        }
    }

    /**
     * Confirms money after the bank-account owner has checked it. Allocation is FIFO only as
     * an internal accounting detail; the accountant never needs to choose an order.
     */
    async confirmCustomerReceipt(id: string, actor: ScopedActor) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer-receipt:' + id}))`
            const receipt = await tx.customerReceipt.findUnique({ where: { id } })
            if (!receipt) throw new NotFoundException('CUSTOMER_RECEIPT_NOT_FOUND')
            if (receipt.status === CustomerReceiptStatus.CONFIRMED || receipt.status === CustomerReceiptStatus.RECONCILED) return receipt
            if (receipt.status !== CustomerReceiptStatus.REPORTED) {
                throw new BadRequestException({ code: 'CUSTOMER_RECEIPT_NOT_CONFIRMABLE', message: 'Khoản thu không ở trạng thái chờ xác nhận.' })
            }

            const remaining = await this.applyReceiptFifo(tx, receipt, actor, null)
            const confirmed = await tx.customerReceipt.update({
                where: { id },
                data: { status: CustomerReceiptStatus.CONFIRMED, confirmedAt: new Date(), confirmedById: actor.userId },
            })
            await this.refreshCollectionPlan(tx, receipt.collectionPlanId)
            return { ...confirmed, appliedAmount: new Prisma.Decimal(receipt.amount).minus(remaining).toString(), unappliedAmount: remaining.toString() }
        })
    }

    /**
     * Trừ một khoản thu vào công nợ khách theo FIFO: khoản phải thu có hạn sớm nhất trước, cùng
     * hạn thì khoản lập trước. Trả về phần tiền chưa trừ được (khách trả thừa).
     * `bankTransactionId` có thì gắn luôn vào bút phân bổ, để dòng sao kê hiện đúng số đã phân bổ.
     *
     * `legalEntity` là pháp nhân của tài khoản nhận tiền — tiền về tài khoản pháp nhân A chỉ được
     * trừ nợ của pháp nhân A (cùng quy tắc với phân bổ tay ở allocateBankReceipt):
     *   - `undefined`: không có dòng sao kê (sale báo, kế toán xác nhận) → giữ cách cũ.
     *   - `{ id }`: chỉ trừ khoản phải thu của đúng pháp nhân đó.
     *   - `{ id: null }`: tài khoản chưa khai pháp nhân → chỉ cho trừ khi khách chỉ nợ ở MỘT
     *     pháp nhân; nợ ở nhiều pháp nhân thì dừng, vì không biết tiền này của pháp nhân nào.
     */
    private async applyReceiptFifo(
        tx: Prisma.TransactionClient,
        receipt: { id: string; customerPartyId: string; currency: string; amount: Prisma.Decimal | number | string; receivedAt: Date },
        actor: ScopedActor,
        bankTransactionId: string | null,
        legalEntity?: { id: string | null },
    ) {
        // One customer lock prevents two confirmations from allocating the same outstanding balance.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'receivable-customer:' + receipt.customerPartyId + ':' + receipt.currency}))`
        const openItems = await tx.receivableOpenItem.findMany({
            where: {
                customerPartyId: receipt.customerPartyId,
                currency: receipt.currency,
                settlementType: 'RECEIVABLE',
                status: { in: openStatuses },
                ...(legalEntity?.id ? { legalEntityId: legalEntity.id } : {}),
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
        })
        if (legalEntity && !legalEntity.id && new Set(openItems.map((item) => item.legalEntityId)).size > 1) {
            throw new BadRequestException({
                code: 'BANK_ACCOUNT_LEGAL_ENTITY_REQUIRED',
                message: 'Khách đang có công nợ ở nhiều pháp nhân nhưng tài khoản nhận tiền chưa khai pháp nhân. Khai pháp nhân cho tài khoản ở màn Tài khoản công ty rồi ghi nhận lại.',
            })
        }

        let remaining = new Prisma.Decimal(receipt.amount)
        for (const item of openItems) {
            if (!remaining.greaterThan(0)) break
            const outstanding = new Prisma.Decimal(item.outstandingAmount)
            const amount = Prisma.Decimal.min(remaining, outstanding)
            const allocation = await tx.receivableAllocation.create({
                data: {
                    customerReceiptId: receipt.id,
                    bankTransactionId,
                    openItemId: item.id,
                    amountInBankCurrency: amount,
                    amountInItemCurrency: amount,
                    fxRate: new Prisma.Decimal(1),
                    idempotencyKey: `customer-receipt:${receipt.id}:${item.id}`,
                    allocatedById: actor.userId,
                    effectiveAt: receipt.receivedAt,
                    allocatedAt: new Date(),
                },
            })
            await tx.receivableLedgerEntry.create({
                data: {
                    openItemId: item.id,
                    type: ReceivableEntryType.RECEIPT,
                    amountDelta: amount.negated(),
                    allocationId: allocation.id,
                    idempotencyKey: `receivable-receipt:${allocation.id}`,
                    effectiveAt: receipt.receivedAt,
                },
            })
            const newOutstanding = outstanding.minus(amount)
            await tx.receivableOpenItem.update({
                where: { id: item.id },
                data: {
                    outstandingAmount: newOutstanding,
                    status: newOutstanding.isZero() ? ReceivableOpenItemStatus.SETTLED : ReceivableOpenItemStatus.PARTIALLY_SETTLED,
                    version: { increment: 1 },
                },
            })
            remaining = remaining.minus(amount)
        }
        return remaining
    }

    /**
     * Ghi nhận hàng loạt dòng tiền về vào công nợ khách (màn Thu tiền). Mỗi dòng chạy trong một
     * giao dịch riêng: một dòng lỗi (đã có người ghi nhận, sai số tiền…) không chặn các dòng khác.
     */
    async postBankReceiptsFifo(dto: PostBankReceiptsFifoDto, actor: ScopedActor) {
        const results: Array<{ bankTransactionId: string; ok: boolean; appliedAmount?: string; unappliedAmount?: string; message?: string }> = []
        for (const item of dto.items) {
            try {
                results.push({ bankTransactionId: item.bankTransactionId, ok: true, ...(await this.postBankReceiptFifo(item, actor)) })
            } catch (error: any) {
                const response = error?.response
                results.push({ bankTransactionId: item.bankTransactionId, ok: false, message: response?.message ?? error?.message ?? 'Lỗi không xác định' })
            }
        }
        return {
            results,
            postedCount: results.filter((row) => row.ok).length,
            failedCount: results.filter((row) => !row.ok).length,
        }
    }

    /** Các bút đã trừ nợ phải cùng pháp nhân với tài khoản nhận tiền (bỏ qua khi tài khoản chưa khai). */
    private assertAllocationsInLegalEntity(allocations: { openItem: { legalEntityId: string } }[], legalEntityId: string | null) {
        if (!legalEntityId) return
        if (allocations.some((row) => row.openItem.legalEntityId !== legalEntityId)) {
            throw new BadRequestException({
                code: 'BANK_ACCOUNT_LEGAL_ENTITY_MISMATCH',
                message: 'Khoản thu đã trừ vào công nợ của pháp nhân khác với tài khoản nhận tiền.',
            })
        }
    }

    private async postBankReceiptFifo(item: BankReceiptFifoItemDto, actor: ScopedActor) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'bank:' + item.bankTransactionId}))`
            const bankTransaction = await tx.bankTransaction.findUnique({
                where: { id: item.bankTransactionId },
                include: {
                    bankAccount: { select: { currency: true, legalEntityId: true } },
                    receivableAllocations: { where: { status: ReceivableAllocationStatus.ACTIVE }, select: { id: true } },
                    customerReceipt: { select: { id: true } },
                },
            })
            if (!bankTransaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            if (bankTransaction.direction !== BankTxnDirection.IN) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_NOT_INCOMING', message: 'Chỉ ghi nhận công nợ cho giao dịch tiền vào.' })
            }
            if (bankTransaction.reconciliationStatus === BankTxnReconciliationStatus.IGNORED) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_IGNORED', message: 'Giao dịch này đã được bỏ qua.' })
            }
            if (bankTransaction.receivableAllocations.length || bankTransaction.customerReceipt) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_ALREADY_POSTED', message: 'Giao dịch này đã được ghi nhận.' })
            }
            const customer = await tx.party.findUnique({ where: { id: item.customerPartyId }, select: { id: true, name: true } })
            if (!customer) throw new NotFoundException('CUSTOMER_NOT_FOUND')

            const currency = (bankTransaction.bankAccount?.currency ?? 'VND').toUpperCase()
            const amount = new Prisma.Decimal(bankTransaction.amount).abs()
            // Tiền về tài khoản pháp nhân nào thì chỉ trừ nợ của pháp nhân đó.
            const legalEntity = { id: bankTransaction.bankAccount?.legalEntityId ?? null }
            let receiptId: string
            let remaining: Prisma.Decimal
            let collectionPlanId: string | null = null

            if (item.customerReceiptId) {
                // Sale đã báo khoản này: dùng lại, không ghi tiền lần hai.
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'customer-receipt:' + item.customerReceiptId}))`
                const receipt = await tx.customerReceipt.findUnique({
                    where: { id: item.customerReceiptId },
                    include: {
                        allocations: {
                            where: { status: ReceivableAllocationStatus.ACTIVE },
                            select: { amountInBankCurrency: true, openItem: { select: { legalEntityId: true } } },
                        },
                    },
                })
                if (!receipt) throw new NotFoundException('CUSTOMER_RECEIPT_NOT_FOUND')
                if (
                    receipt.customerPartyId !== item.customerPartyId ||
                    receipt.bankTransactionId ||
                    receipt.currency !== currency ||
                    !new Prisma.Decimal(receipt.amount).equals(amount)
                ) {
                    throw new BadRequestException({ code: 'BANK_TRANSACTION_RECEIPT_MISMATCH', message: 'Khoản thu đã báo không khớp khách hoặc số tiền của giao dịch.' })
                }
                receiptId = receipt.id
                collectionPlanId = receipt.collectionPlanId
                if (receipt.status === CustomerReceiptStatus.REPORTED) {
                    // Ngày trừ nợ lấy theo ngày giao dịch trên sao kê, không theo ngày sale báo.
                    remaining = await this.applyReceiptFifo(tx, { ...receipt, receivedAt: bankTransaction.txnDate }, actor, bankTransaction.id, legalEntity)
                } else if (receipt.status === CustomerReceiptStatus.CONFIRMED) {
                    // Đã trừ nợ lúc xác nhận (khi chưa biết tiền về tài khoản nào): chỉ ghép được
                    // nếu phần đã trừ nằm đúng pháp nhân của tài khoản nhận tiền.
                    this.assertAllocationsInLegalEntity(receipt.allocations, legalEntity.id)
                    // Chỉ gắn các bút phân bổ vào dòng sao kê.
                    await tx.receivableAllocation.updateMany({
                        where: { customerReceiptId: receipt.id, status: ReceivableAllocationStatus.ACTIVE },
                        data: { bankTransactionId: bankTransaction.id },
                    })
                    const applied = receipt.allocations.reduce((sum, row) => sum.plus(row.amountInBankCurrency), new Prisma.Decimal(0))
                    remaining = amount.minus(applied)
                } else {
                    throw new BadRequestException({ code: 'CUSTOMER_RECEIPT_NOT_CONFIRMABLE', message: 'Khoản thu đã báo không còn ở trạng thái ghép được.' })
                }
            } else {
                const receipt = await tx.customerReceipt.create({
                    data: {
                        customerPartyId: item.customerPartyId,
                        amount,
                        currency,
                        // Ngày trừ nợ là ngày giao dịch trên sao kê, không phải ngày hạch toán hay ngày import.
                        receivedAt: bankTransaction.txnDate,
                        transferReference: bankTransaction.externalRef ?? null,
                        note: 'Ghi nhận từ sao kê ngân hàng',
                        reportedById: actor.userId,
                    },
                })
                receiptId = receipt.id
                remaining = await this.applyReceiptFifo(tx, receipt, actor, bankTransaction.id, legalEntity)
            }

            await tx.customerReceipt.update({
                where: { id: receiptId },
                data: {
                    bankTransactionId: bankTransaction.id,
                    status: CustomerReceiptStatus.RECONCILED,
                    confirmedAt: new Date(),
                    confirmedById: actor.userId,
                },
            })
            await tx.bankTransaction.update({
                where: { id: bankTransaction.id },
                data: {
                    matchStatus: BankTxnMatchStatus.MANUAL_MATCHED,
                    reconciliationStatus: remaining.greaterThan(0) ? BankTxnReconciliationStatus.PARTIALLY_ALLOCATED : BankTxnReconciliationStatus.ALLOCATED,
                    counterpartyType: 'CUSTOMER',
                    counterpartyId: item.customerPartyId,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                    confirmedBy: actor.userId,
                },
            })

            const accountNo = String(bankTransaction.counterpartyAcc ?? '').replace(/\D/g, '')
            if (item.rememberAccount && accountNo.length >= 6) {
                await tx.partyBankAccount.upsert({
                    where: { partyId_accountNo: { partyId: item.customerPartyId, accountNo } },
                    update: { isActive: true },
                    create: {
                        partyId: item.customerPartyId,
                        accountNo,
                        accountName: bankTransaction.counterpartyName?.trim() || customer.name,
                        bankName: 'Ghi nhận từ sao kê',
                    },
                })
            }
            await this.refreshCollectionPlan(tx, collectionPlanId)
            return { appliedAmount: amount.minus(remaining).toString(), unappliedAmount: remaining.toString() }
        })
    }

    /** Match a confirmed manual receipt to an imported bank line without posting it a second time. */
    async reconcileCustomerReceipt(id: string, bankTransactionId: string, actor: ScopedActor) {
        return this.prisma.$transaction(async (tx) => {
            for (const key of [`bank:${bankTransactionId}`, `customer-receipt:${id}`].sort()) {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
            }
            const receipt = await tx.customerReceipt.findUnique({ where: { id } })
            if (!receipt) throw new NotFoundException('CUSTOMER_RECEIPT_NOT_FOUND')
            if (receipt.status !== CustomerReceiptStatus.CONFIRMED && receipt.status !== CustomerReceiptStatus.RECONCILED) {
                throw new BadRequestException({ code: 'CUSTOMER_RECEIPT_NOT_CONFIRMED', message: 'Chỉ khoản thu đã xác nhận mới được đối soát sao kê.' })
            }
            if (receipt.bankTransactionId && receipt.bankTransactionId !== bankTransactionId) {
                throw new BadRequestException({ code: 'CUSTOMER_RECEIPT_ALREADY_RECONCILED', message: 'Khoản thu đã ghép với một giao dịch ngân hàng khác.' })
            }
            const bankTransaction = await tx.bankTransaction.findUnique({
                where: { id: bankTransactionId },
                include: { bankAccount: { select: { currency: true, legalEntityId: true } }, receivableAllocations: { where: { status: ReceivableAllocationStatus.ACTIVE }, select: { id: true } }, customerReceipt: { select: { id: true } } },
            })
            if (!bankTransaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            if (bankTransaction.direction !== BankTxnDirection.IN || bankTransaction.reconciliationStatus === BankTxnReconciliationStatus.IGNORED) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_NOT_RECONCILABLE', message: 'Giao dịch ngân hàng không thể dùng để đối soát khoản thu này.' })
            }
            if (bankTransaction.customerReceipt && bankTransaction.customerReceipt.id !== id) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_ALREADY_RECONCILED', message: 'Giao dịch ngân hàng đã ghép với khoản thu khác.' })
            }
            if (bankTransaction.receivableAllocations.length || bankTransaction.bankAccount.currency !== receipt.currency || !new Prisma.Decimal(bankTransaction.amount).abs().equals(receipt.amount)) {
                throw new BadRequestException({ code: 'BANK_TRANSACTION_RECEIPT_MISMATCH', message: 'Số tiền hoặc loại tiền sao kê không khớp khoản thu đã xác nhận.' })
            }
            // Khoản thu đã trừ nợ theo FIFO lúc xác nhận; tiền phải về đúng tài khoản của pháp nhân đó.
            const receiptAllocations = await tx.receivableAllocation.findMany({
                where: { customerReceiptId: id, status: ReceivableAllocationStatus.ACTIVE },
                select: { openItem: { select: { legalEntityId: true } } },
            })
            this.assertAllocationsInLegalEntity(receiptAllocations, bankTransaction.bankAccount.legalEntityId)
            const updated = await tx.customerReceipt.update({ where: { id }, data: { bankTransactionId, status: CustomerReceiptStatus.RECONCILED } })
            await tx.bankTransaction.update({
                where: { id: bankTransactionId },
                data: {
                    matchStatus: BankTxnMatchStatus.MANUAL_MATCHED,
                    reconciliationStatus: BankTxnReconciliationStatus.ALLOCATED,
                    counterpartyType: 'CUSTOMER',
                    counterpartyId: receipt.customerPartyId,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                    confirmedBy: actor.userId,
                },
            })
            return updated
        })
    }

    /**
     * Hạn mức có hiệu lực tại một thời điểm, dựng lại từ nhật ký thay đổi.
     *
     * `history` phải là TOÀN BỘ nhật ký của khách, sắp tăng dần theo thời gian — kể cả các
     * lần đổi sau thời điểm đang xét. Trước lần đổi đầu tiên, hạn mức là `oldLimit` của
     * chính lần đổi đó; trước đây chỗ này lấy hạn mức hiện tại của khách, nên báo cáo kỳ
     * cũ bị so với hạn mức đã được nâng về sau (vd. tháng 3 nợ 1,5 tỷ trên hạn mức 1 tỷ,
     * tháng 6 nâng lên 2 tỷ → báo cáo tháng 3 hiện "không vượt"). Cùng cách dựng với dòng
     * thời gian hạn mức ở màn cấu hình (SalesCreditService.buildTimeline).
     */
    private limitAt(
        customer: { creditLimit: Prisma.Decimal | null; tempLimit: Prisma.Decimal | null; tempFrom: Date | null; tempTo: Date | null },
        history: Array<{ changedAt: Date; oldLimit: Prisma.Decimal | null; newLimit: Prisma.Decimal | null; tempLimit: Prisma.Decimal | null; tempFrom: Date | null; tempTo: Date | null }>,
        at: Date,
    ) {
        /*
         * Xét theo NGÀY LỊCH, không theo khoảnh khắc — vì số dư đem so là số dư CUỐI NGÀY.
         * Trước đây hạn mức lấy lúc 0 giờ sáng: khách SONHAI được sếp nâng hạn mức 5 → 20 tỷ
         * lúc 15:52, xuất hóa đơn 13,765 tỷ lúc 15:55 cùng ngày, nhưng số dư cuối ngày bị
         * so với hạn mức 5 tỷ của lúc nửa đêm → báo "vượt 175%" trong khi quy trình đúng.
         *
         * - Lần đổi hạn mức nào trong ngày cũng tính cho cả ngày đó (so với cuối ngày).
         * - Hạn mức tạm có hiệu lực nếu khoảng tạm CHẠM tới ngày đó. tempFrom/tempTo là ngày
         *   (lưu nửa đêm UTC = 7 giờ sáng giờ VN), nên so với đầu/cuối ngày mới lấy trọn ngày
         *   đầu và ngày cuối; so theo khoảnh khắc sẽ đánh rơi ngày cuối của đợt tạm.
         */
        const dayStart = new Date(at)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(at)
        dayEnd.setHours(23, 59, 59, 999)
        let applicable: (typeof history)[number] | undefined
        for (let index = history.length - 1; index >= 0; index -= 1) {
            if (history[index].changedAt <= dayEnd) {
                applicable = history[index]
                break
            }
        }
        let baseLimit: Prisma.Decimal | null
        let tempLimit: Prisma.Decimal | null
        let tempFrom: Date | null
        let tempTo: Date | null
        if (applicable) {
            baseLimit = applicable.newLimit
            tempLimit = applicable.tempLimit
            tempFrom = applicable.tempFrom
            tempTo = applicable.tempTo
        } else if (history.length) {
            // Trước lần đổi đầu tiên: nhật ký không ghi hạn mức tạm của thời kỳ ấy, nên chỉ
            // dựa vào hạn mức cơ sở — không mượn hạn mức tạm của hiện tại.
            baseLimit = history[0].oldLimit
            tempLimit = null
            tempFrom = null
            tempTo = null
        } else {
            baseLimit = customer.creditLimit
            tempLimit = customer.tempLimit
            tempFrom = customer.tempFrom
            tempTo = customer.tempTo
        }
        const temporaryApplies = tempLimit != null && (!tempFrom || tempFrom <= dayEnd) && (!tempTo || tempTo >= dayStart)
        return temporaryApplies ? tempLimit : baseLimit
    }

    private dayKey(value: Date) {
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    }

    /**
     * The main working report: balances and collection promises are both summarized by customer.
     * All historic balances derive from immutable ledger entries, never today's open-item balance.
     */
    async creditManagement(query: CreditManagementQueryDto) {
        const period = this.period(query.fromDate, query.toDate)
        const { from } = period
        /*
         * Không tính sang tương lai. Trước đây xem năm đang chạy thì kỳ kéo tới 31/12, các ngày
         * chưa tới được tính bằng số dư hôm nay — dư nợ bình quân lệch về số dư hôm nay, và
         * khách đang vượt hạn mức bị cộng thêm hàng trăm "ngày vượt" chưa xảy ra.
         */
        const endOfToday = new Date()
        endOfToday.setHours(23, 59, 59, 999)
        const to = period.to > endOfToday ? endOfToday : period.to
        const fromText = this.dayKey(from)
        const toText = this.dayKey(to)

        const [items, plans, pendingReceipts] = await Promise.all([
            this.prisma.receivableOpenItem.findMany({
                where: {
                    customerPartyId: query.customerPartyId ?? undefined,
                    settlementType: 'RECEIVABLE',
                    ...(query.accountingOwnerEmpId ? { customer: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
                },
                include: {
                    customer: { select: { id: true, code: true, name: true, creditLimit: true, tempLimit: true, tempFrom: true, tempTo: true } },
                    entries: { where: { effectiveAt: { lte: to } }, select: { effectiveAt: true, amountDelta: true, type: true } },
                },
            }),
            this.prisma.customerCollectionPlan.findMany({
                where: {
                    customerPartyId: query.customerPartyId ?? undefined,
                    ...(query.accountingOwnerEmpId ? { customer: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
                    plannedDate: { gte: from, lte: to },
                    // Kế hoạch đã hẹn lại vẫn là một lời hứa đã lỡ của kỳ gốc — bỏ nó đi thì kỳ
                    // có khách hẹn 3 lần, lỡ 2 lần rồi xin dời sẽ hiện "hoàn thành 100%". Tiền đã
                    // thu nằm lại trên kế hoạch cũ, kế hoạch mới chỉ mang phần còn thiếu, nên
                    // không đếm trùng tiền thu giữa hai kỳ.
                    status: { in: [CollectionPlanStatus.ACTIVE, CollectionPlanStatus.COMPLETED, CollectionPlanStatus.CARRIED_FORWARD] },
                },
                include: {
                    customer: { select: { id: true, code: true, name: true, creditLimit: true, tempLimit: true, tempFrom: true, tempTo: true } },
                    receipts: { select: { amount: true, status: true, receivedAt: true } },
                },
            }),
            this.prisma.customerReceipt.findMany({
                where: {
                    customerPartyId: query.customerPartyId ?? undefined,
                    ...(query.accountingOwnerEmpId ? { customer: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
                    status: CustomerReceiptStatus.REPORTED,
                    receivedAt: { gte: from, lte: to },
                },
                select: {
                    customerPartyId: true,
                    amount: true,
                    customer: { select: { id: true, code: true, name: true, creditLimit: true, tempLimit: true, tempFrom: true, tempTo: true } },
                },
            }),
        ])
        const customerMap = new Map<string, any>()
        const ensure = (customer: any) => {
            const current = customerMap.get(customer.id) ?? {
                customer,
                openingDebt: new Prisma.Decimal(0),
                debtIncrease: new Prisma.Decimal(0),
                collectedAmount: new Prisma.Decimal(0),
                otherDecrease: new Prisma.Decimal(0),
                dailyChanges: new Map<string, Prisma.Decimal>(),
                plannedAmount: new Prisma.Decimal(0),
                plannedActualAmount: new Prisma.Decimal(0),
                pendingReportedAmount: new Prisma.Decimal(0),
            }
            customerMap.set(customer.id, current)
            return current
        }
        for (const item of items) {
            const row = ensure(item.customer)
            for (const entry of item.entries) {
                const amount = new Prisma.Decimal(entry.amountDelta)
                if (entry.effectiveAt < from) {
                    row.openingDebt = row.openingDebt.plus(amount)
                    continue
                }
                /*
                 * Mỗi bút toán rơi vào đúng một cột, nên dòng luôn cộng khớp:
                 *   Đầu kỳ + Phát sinh − Đã thu − Giảm khác = Cuối kỳ.
                 *
                 * Trước đây mọi bút toán dương đều bị tính là "Phát sinh nợ": đảo một khoản tiền
                 * đã phân bổ (REVERSAL dương — nợ quay lại) thành ra doanh số mới, và "Đã thu"
                 * vẫn giữ nguyên khoản đã bị đảo. REVERSAL mang hai nghĩa ngược dấu — dương là
                 * hoàn tác tiền đã thu (ReceivablesService.reverseAllocation), âm là hủy khoản nợ
                 * (hủy số dư đầu kỳ) — nên phải tách theo dấu chứ không theo loại.
                 */
                if (entry.type === ReceivableEntryType.OPEN) {
                    row.debtIncrease = row.debtIncrease.plus(amount)
                } else if (entry.type === ReceivableEntryType.RECEIPT) {
                    row.collectedAmount = row.collectedAmount.minus(amount)
                } else if (entry.type === ReceivableEntryType.REVERSAL && amount.greaterThan(0)) {
                    row.collectedAmount = row.collectedAmount.minus(amount)
                } else {
                    row.otherDecrease = row.otherDecrease.minus(amount)
                }
                const key = this.dayKey(entry.effectiveAt)
                row.dailyChanges.set(key, (row.dailyChanges.get(key) ?? new Prisma.Decimal(0)).plus(amount))
            }
        }
        for (const plan of plans) {
            const row = ensure(plan.customer)
            row.plannedAmount = row.plannedAmount.plus(plan.plannedAmount)
            // Chỉ tiền đã về tới ngày cuối kỳ: mở lại báo cáo tháng 8 hôm nay không được lẫn tiền
            // khách trả trong tháng 9 — cùng mốc với các cột nợ, vốn đã chốt theo ngày.
            row.plannedActualAmount = row.plannedActualAmount.plus(
                this.receiptTotal(plan.receipts.filter((receipt) => receipt.receivedAt <= to)),
            )
        }
        for (const receipt of pendingReceipts) {
            const customer = ensure(receipt.customer)
            customer.pendingReportedAmount = customer.pendingReportedAmount.plus(receipt.amount)
        }

        const customerIds = [...customerMap.keys()]
        // Lấy đủ nhật ký kể cả các lần đổi SAU kỳ: cần oldLimit của lần đổi đầu tiên để biết
        // hạn mức của những ngày trước nó (xem limitAt).
        const histories = customerIds.length
            ? await this.prisma.creditLimitHistory.findMany({
                  where: { customerId: { in: customerIds } },
                  select: { customerId: true, changedAt: true, oldLimit: true, newLimit: true, tempLimit: true, tempFrom: true, tempTo: true },
                  orderBy: { changedAt: 'asc' },
              })
            : []
        const historyByCustomer = new Map<string, any[]>()
        for (const history of histories) historyByCustomer.set(history.customerId, [...(historyByCustomer.get(history.customerId) ?? []), history])

        const itemsOut = [...customerMap.values()].map((row) => {
            let debt = row.openingDebt
            let peakDebt = debt
            let maxOverRate = new Prisma.Decimal(0)
            let daysOverLimit = 0
            let totalDailyDebt = new Prisma.Decimal(0)
            let dayCount = 0
            const day = new Date(from)
            const history = historyByCustomer.get(row.customer.id) ?? []
            while (day <= to) {
                debt = debt.plus(row.dailyChanges.get(this.dayKey(day)) ?? 0)
                if (debt.greaterThan(peakDebt)) peakDebt = debt
                totalDailyDebt = totalDailyDebt.plus(debt)
                dayCount += 1
                const limit = this.limitAt(row.customer, history, day)
                // Hạn mức 0 là "không cho nợ": còn nợ đồng nào là một ngày vượt. Tỷ lệ % thì
                // không chia được cho 0, nên chỉ tính khi hạn mức dương.
                if (limit != null && debt.greaterThan(limit)) {
                    daysOverLimit += 1
                    if (new Prisma.Decimal(limit).greaterThan(0)) {
                        const rate = debt.minus(limit).div(limit).mul(100)
                        if (rate.greaterThan(maxOverRate)) maxOverRate = rate
                    }
                }
                day.setDate(day.getDate() + 1)
            }
            const limitAtStart = this.limitAt(row.customer, history, from)
            const limitAtEnd = this.limitAt(row.customer, history, to)
            const overAmount = limitAtEnd == null ? null : Prisma.Decimal.max(debt.minus(limitAtEnd), 0)
            const plannedCompleted = Prisma.Decimal.min(row.plannedActualAmount, row.plannedAmount)
            return {
                customer: { id: row.customer.id, code: row.customer.code, name: row.customer.name },
                openingDebt: row.openingDebt.toString(),
                debtIncrease: row.debtIncrease.toString(),
                collectedAmount: row.collectedAmount.toString(),
                otherDecrease: row.otherDecrease.toString(),
                closingDebt: debt.toString(),
                peakClosingDebt: peakDebt.toString(),
                // Kỳ nằm trọn trong tương lai thì không có ngày nào để lấy bình quân.
                averageClosingDebt: (dayCount ? totalDailyDebt.div(dayCount) : debt).toDecimalPlaces(2).toString(),
                creditLimitAtStart: limitAtStart == null ? null : new Prisma.Decimal(limitAtStart).toString(),
                creditLimit: limitAtEnd == null ? null : new Prisma.Decimal(limitAtEnd).toString(),
                overAmount: overAmount == null ? null : overAmount.toString(),
                overRate: limitAtEnd == null || new Prisma.Decimal(limitAtEnd).isZero() ? null : overAmount!.div(limitAtEnd).mul(100).toDecimalPlaces(2).toString(),
                maxOverRate: maxOverRate.toDecimalPlaces(2).toString(),
                daysOverLimit,
                plannedAmount: row.plannedAmount.toString(),
                plannedActualAmount: row.plannedActualAmount.toString(),
                plannedRemainingAmount: Prisma.Decimal.max(row.plannedAmount.minus(row.plannedActualAmount), 0).toString(),
                planCompletionRate: row.plannedAmount.isZero() ? null : plannedCompleted.div(row.plannedAmount).mul(100).toDecimalPlaces(2).toString(),
                pendingReportedAmount: row.pendingReportedAmount.toString(),
            }
        })
        return { fromDate: fromText, toDate: toText, items: itemsOut.sort((a, b) => Number(b.closingDebt) - Number(a.closingDebt)) }
    }

    async annualCreditIndicators(year: number, customerPartyId?: string, accountingOwnerEmpId?: string) {
        const result = await this.creditManagement({
            customerPartyId,
            accountingOwnerEmpId,
            fromDate: `${year}-01-01`,
            toDate: `${year}-12-31`,
        })
        const customerIds = result.items.map((item) => item.customer.id)
        const proposals = customerIds.length
            ? await this.prisma.creditLimitProposal.findMany({
                  where: { year: year + 1, customerId: { in: customerIds } },
                  select: { customerId: true, proposedLimit: true, approvedLimit: true, status: true, reason: true },
              })
            : []
        const proposalByCustomer = new Map(proposals.map((proposal) => [proposal.customerId, proposal]))
        return {
            year,
            ...result,
            items: result.items.map((item) => {
                const proposal = proposalByCustomer.get(item.customer.id)
                return {
                    ...item,
                    /*
                     * Tỷ lệ vượt của năm là mức vượt cao nhất khi so TỪNG NGÀY với hạn mức có hiệu
                     * lực đúng ngày đó. Trước đây lấy đỉnh nợ (có thể rơi vào tháng 3) chia cho hạn
                     * mức ngày 31/12 (có thể đã được nâng từ tháng 7, hoặc đã là hạn mức năm sau
                     * nếu đề xuất được áp dụng trước Tết) — hai con số ở hai thời điểm khác nhau.
                     */
                    annualOverRate: item.creditLimit == null ? null : item.maxOverRate,
                    nextYearProposedLimit: proposal?.proposedLimit?.toString() ?? null,
                    nextYearApprovedLimit: proposal?.approvedLimit?.toString() ?? null,
                    nextYearProposalStatus: proposal?.status ?? null,
                    nextYearProposalReason: proposal?.reason ?? null,
                }
            }),
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
                    ...(query.accountingOwnerEmpId ? { customer: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
                    status: { in: openStatuses },
                },
                include: { customer: { select: { id: true, code: true, name: true } } },
            }),
            this.prisma.payableOpenItem.findMany({
                where: {
                    supplierPartyId: query.partyId ?? undefined,
                    ...(query.accountingOwnerEmpId ? { supplier: { accountingOwnerEmpId: query.accountingOwnerEmpId } } : {}),
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
