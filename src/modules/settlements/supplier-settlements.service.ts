// src/modules/settlements/supplier-settlements/supplier-settlements.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { BankTxnDirection, BankTxnMatchStatus, Prisma, SettlementStatus, SettlementType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class SupplierSettlementsService {
    constructor(private readonly prisma: PrismaService) {}

    async create(dto: { supplierCustomerId: string; type: SettlementType; amountTotal: number; dueDate?: string; note?: string }) {
        if (dto.amountTotal <= 0) throw new BadRequestException('SETTLEMENT_AMOUNT_INVALID')

        return this.prisma.supplierSettlement.create({
            data: {
                supplierCustomerId: dto.supplierCustomerId,
                type: dto.type,
                status: SettlementStatus.OPEN,
                amountTotal: new Prisma.Decimal(dto.amountTotal),
                amountSettled: new Prisma.Decimal(0),
                dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
                note: dto.note ?? null,
            },
        })
    }

    async detail(id: string) {
        const st = await this.prisma.supplierSettlement.findUnique({
            where: { id },
            include: {
                supplier: true,
                invoices: true,
                allocations: { include: { bankTransaction: true } },
            },
        })
        if (!st) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
        return st
    }

    async list(q: { supplierCustomerId?: string; type?: SettlementType; status?: string; dueFrom?: string; dueTo?: string; page?: number; limit?: number }) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.SupplierSettlementWhereInput = {
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            type: q.type ?? undefined,
            status: (q.status as any) ?? undefined,
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
            this.prisma.supplierSettlement.findMany({
                where,
                orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
                skip,
                take: limit,
                include: { supplier: true },
            }),
            this.prisma.supplierSettlement.count({ where }),
        ])

        return { items, total, page, limit }
    }

    /**
     * Manual allocation:
     * - bank txn must be OUT (chi tiền)
     * - settlement not VOID
     * - allocatedAmount > 0
     * - sum allocations <= txn.amount (optional strict)
     * - sum allocations <= settlement.remaining
     * - update settlement.amountSettled + status
     * - update bank txn matchStatus (UNMATCHED -> PARTIAL/MANUAL)
     */
    async allocate(settlementId: string, dto: { bankTransactionId: string; allocatedAmount: number; note?: string }) {
        if (dto.allocatedAmount <= 0) throw new BadRequestException('ALLOC_AMOUNT_INVALID')

        return this.prisma.$transaction(async (tx) => {
            const st = await tx.supplierSettlement.findUnique({
                where: { id: settlementId },
                include: { allocations: true },
            })
            if (!st) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
            if (st.status === SettlementStatus.VOID) throw new BadRequestException('SETTLEMENT_VOID')

            const txn = await tx.bankTransaction.findUnique({
                where: { id: dto.bankTransactionId },
                include: { allocations: true },
            })
            if (!txn) throw new NotFoundException('BANK_TXN_NOT_FOUND')

            if (txn.direction !== BankTxnDirection.OUT) {
                throw new BadRequestException('BANK_TXN_DIRECTION_INVALID')
            }

            const allocAmt = new Prisma.Decimal(dto.allocatedAmount)

            const stRemaining = new Prisma.Decimal(st.amountTotal).minus(new Prisma.Decimal(st.amountSettled))
            if (allocAmt.greaterThan(stRemaining)) throw new BadRequestException('SETTLEMENT_OVER_ALLOCATE')

            const txnAllocated = txn.allocations.reduce((sum, a) => sum.plus(new Prisma.Decimal(a.allocatedAmount)), new Prisma.Decimal(0))
            const txnRemaining = new Prisma.Decimal(txn.amount).minus(txnAllocated)
            if (allocAmt.greaterThan(txnRemaining)) throw new BadRequestException('BANK_TXN_OVER_ALLOCATE')

            const allocation = await tx.paymentAllocation.create({
                data: {
                    bankTransactionId: txn.id,
                    settlementId: st.id,
                    allocatedAmount: allocAmt,
                    isAuto: false,
                    score: null,
                    note: dto.note ?? null,
                },
            })

            const newSettled = new Prisma.Decimal(st.amountSettled).plus(allocAmt)
            const newStatus = newSettled.greaterThanOrEqualTo(new Prisma.Decimal(st.amountTotal)) ? SettlementStatus.SETTLED : SettlementStatus.PARTIAL

            const updatedSettlement = await tx.supplierSettlement.update({
                where: { id: st.id },
                data: {
                    amountSettled: newSettled,
                    status: newStatus,
                },
            })

            const newTxnAllocated = txnAllocated.plus(allocAmt)
            const txnIsFull = newTxnAllocated.greaterThanOrEqualTo(new Prisma.Decimal(txn.amount))

            await tx.bankTransaction.update({
                where: { id: txn.id },
                data: {
                    matchStatus: txnIsFull ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                },
            })

            return { settlement: updatedSettlement, allocation }
        })
    }

    async void(settlementId: string) {
        return this.prisma.$transaction(async (tx) => {
            const st = await tx.supplierSettlement.findUnique({
                where: { id: settlementId },
                include: { allocations: true },
            })
            if (!st) throw new NotFoundException('SETTLEMENT_NOT_FOUND')
            if (st.allocations.length) throw new BadRequestException('SETTLEMENT_ALREADY_ALLOCATED')

            return tx.supplierSettlement.update({
                where: { id: st.id },
                data: { status: SettlementStatus.VOID },
            })
        })
    }
}
