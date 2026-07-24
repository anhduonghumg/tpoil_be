import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'node:crypto'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    PayableAllocationStatus,
    PayableEntryType,
    PayableOpenItemStatus,
    Prisma,
    SettlementType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class SupplierSettlementsService {
    constructor(private readonly prisma: PrismaService) {}

    private legacyStatus(status: PayableOpenItemStatus) {
        if (status === PayableOpenItemStatus.PARTIALLY_SETTLED) return 'PARTIAL'
        if (status === PayableOpenItemStatus.VOIDED) return 'VOID'
        return status
    }

    private response<T extends {
        supplierPartyId: string
        settlementType: SettlementType
        originalAmount: Prisma.Decimal
        outstandingAmount: Prisma.Decimal
        status: PayableOpenItemStatus
        allocations?: Array<{ amountInItemCurrency: Prisma.Decimal } & Record<string, unknown>>
    }>(item: T) {
        return {
            ...item,
            supplierCustomerId: item.supplierPartyId,
            type: item.settlementType,
            amountTotal: item.originalAmount,
            amountSettled: item.originalAmount.minus(item.outstandingAmount),
            status: this.legacyStatus(item.status),
            allocations: item.allocations?.map((allocation) => ({
                ...allocation,
                allocatedAmount: allocation.amountInItemCurrency,
            })),
        }
    }

    async create(dto: {
        supplierCustomerId: string
        type: SettlementType
        amountTotal: number
        dueDate?: string
        note?: string
    }) {
        if (dto.amountTotal <= 0) throw new BadRequestException('SETTLEMENT_AMOUNT_INVALID')
        const item = await this.prisma.$transaction(async (tx) => {
            const assignment = await tx.warehousePartyAssignment.findFirst({
                where: { partyId: dto.supplierCustomerId, validTo: null },
                select: { warehouse: { select: { legalEntityId: true } } },
            })
            const legalEntity = assignment
                ? { id: assignment.warehouse.legalEntityId }
                : await tx.legalEntity.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } })
            if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_CONFIGURED')
            const amount = new Prisma.Decimal(dto.amountTotal)
            return tx.payableOpenItem.create({
                data: {
                    legalEntityId: legalEntity.id,
                    supplierPartyId: dto.supplierCustomerId,
                    currency: 'VND',
                    originalAmount: amount,
                    outstandingAmount: amount,
                    dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                    settlementType: dto.type,
                    note: dto.note?.trim() || null,
                    entries: {
                        create: {
                            type: PayableEntryType.OPEN,
                            amountDelta: amount,
                            idempotencyKey: `manual-open-item:${randomUUID()}`,
                            effectiveAt: new Date(),
                        },
                    },
                },
            })
        })
        return this.response(item)
    }

    async detail(id: string) {
        const item = await this.prisma.payableOpenItem.findUnique({
            where: { id },
            include: {
                supplier: true,
                invoice: true,
                entries: { orderBy: { effectiveAt: 'asc' } },
                allocations: { include: { bankTransaction: true }, orderBy: { allocatedAt: 'asc' } },
            },
        })
        if (!item) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
        return this.response(item)
    }

    async list(q: {
        supplierCustomerId?: string
        type?: SettlementType
        status?: string
        dueFrom?: string
        dueTo?: string
        page?: number
        limit?: number
    }) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const status =
            q.status === 'PARTIAL'
                ? PayableOpenItemStatus.PARTIALLY_SETTLED
                : q.status === 'VOID'
                  ? PayableOpenItemStatus.VOIDED
                  : (q.status as PayableOpenItemStatus | undefined)
        const where: Prisma.PayableOpenItemWhereInput = {
            supplierPartyId: q.supplierCustomerId,
            settlementType: q.type,
            status,
            ...(q.dueFrom || q.dueTo
                ? {
                      dueDate: {
                          gte: q.dueFrom ? new Date(q.dueFrom) : undefined,
                          lte: q.dueTo ? new Date(q.dueTo) : undefined,
                      },
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.payableOpenItem.findMany({
                where,
                orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
                include: { supplier: true },
            }),
            this.prisma.payableOpenItem.count({ where }),
        ])
        return { items: items.map((item) => this.response(item)), total, page, limit }
    }

    async allocate(openItemId: string, dto: { bankTransactionId: string; allocatedAmount: number; note?: string }) {
        if (dto.allocatedAmount <= 0) throw new BadRequestException('ALLOC_AMOUNT_INVALID')
        await this.prisma.$transaction(async (tx) => {
            const lockKeys = [`ap:${openItemId}`, `bank:${dto.bankTransactionId}`].sort()
            for (const key of lockKeys) {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
            }
            const item = await tx.payableOpenItem.findUnique({ where: { id: openItemId } })
            if (!item) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
            if (item.status === PayableOpenItemStatus.VOIDED) throw new BadRequestException('SETTLEMENT_VOID')
            if (item.status === PayableOpenItemStatus.SETTLED) throw new BadRequestException('SETTLEMENT_ALREADY_PAID')

            const transaction = await tx.bankTransaction.findUnique({
                where: { id: dto.bankTransactionId },
                include: {
                    bankAccount: true,
                    payableAllocations: { where: { status: PayableAllocationStatus.ACTIVE } },
                },
            })
            if (!transaction) throw new NotFoundException('BANK_TXN_NOT_FOUND')
            if (transaction.direction !== BankTxnDirection.OUT) {
                throw new BadRequestException('BANK_TXN_DIRECTION_INVALID')
            }
            if (transaction.bankAccount.currency !== item.currency) {
                throw new BadRequestException('PAYMENT_CURRENCY_MISMATCH')
            }

            const amount = new Prisma.Decimal(dto.allocatedAmount)
            if (amount.greaterThan(item.outstandingAmount)) {
                throw new BadRequestException('SETTLEMENT_OVER_ALLOCATE')
            }
            const bankAllocated = transaction.payableAllocations.reduce(
                (sum, allocation) => sum.plus(allocation.amountInBankCurrency),
                new Prisma.Decimal(0),
            )
            if (amount.greaterThan(new Prisma.Decimal(transaction.amount).minus(bankAllocated))) {
                throw new BadRequestException('BANK_TXN_OVER_ALLOCATE')
            }

            const idempotencyKey = `manual:${transaction.id}:${item.id}`
            const existing = await tx.payableAllocation.findUnique({ where: { idempotencyKey } })
            if (existing) return
            const allocation = await tx.payableAllocation.create({
                data: {
                    bankTransactionId: transaction.id,
                    openItemId: item.id,
                    amountInBankCurrency: amount,
                    amountInItemCurrency: amount,
                    fxRate: 1,
                    idempotencyKey,
                    allocatedAt: new Date(),
                },
            })
            await tx.payableLedgerEntry.create({
                data: {
                    openItemId: item.id,
                    type: PayableEntryType.PAYMENT,
                    amountDelta: amount.negated(),
                    allocationId: allocation.id,
                    idempotencyKey: `${idempotencyKey}:ledger`,
                    effectiveAt: allocation.allocatedAt,
                },
            })
            const outstandingAmount = new Prisma.Decimal(item.outstandingAmount).minus(amount)
            await tx.payableOpenItem.update({
                where: { id: item.id },
                data: {
                    outstandingAmount,
                    status: outstandingAmount.isZero()
                        ? PayableOpenItemStatus.SETTLED
                        : PayableOpenItemStatus.PARTIALLY_SETTLED,
                    version: { increment: 1 },
                },
            })
            const totalBankAllocated = bankAllocated.plus(amount)
            await tx.bankTransaction.update({
                where: { id: transaction.id },
                data: {
                    matchStatus: totalBankAllocated.greaterThanOrEqualTo(transaction.amount)
                        ? BankTxnMatchStatus.MANUAL_MATCHED
                        : BankTxnMatchStatus.PARTIAL_MATCHED,
                },
            })
        })
        return this.detail(openItemId)
    }

    async void(openItemId: string) {
        await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'ap:' + openItemId}))`
            const item = await tx.payableOpenItem.findUnique({
                where: { id: openItemId },
                include: { allocations: { where: { status: PayableAllocationStatus.ACTIVE } } },
            })
            if (!item) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
            if (item.status === PayableOpenItemStatus.VOIDED) return
            if (item.allocations.length) throw new BadRequestException('SETTLEMENT_ALREADY_ALLOCATED')
            await tx.payableLedgerEntry.create({
                data: {
                    openItemId: item.id,
                    type: PayableEntryType.REVERSAL,
                    amountDelta: item.outstandingAmount.negated(),
                    idempotencyKey: `manual-open-item:${item.id}:void`,
                    effectiveAt: new Date(),
                },
            })
            await tx.payableOpenItem.update({
                where: { id: item.id },
                data: {
                    outstandingAmount: 0,
                    status: PayableOpenItemStatus.VOIDED,
                    version: { increment: 1 },
                },
            })
        })
        return this.detail(openItemId)
    }
}
