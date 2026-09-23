import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankImportStatus,
    BankTransactionSource,
    BankTxnDirection,
    BankTxnMatchStatus,
    PayableAllocationStatus,
    PayableEntryType,
    PayableOpenItemStatus,
    Prisma,
} from '@prisma/client'
import * as ExcelJS from 'exceljs'
import * as XLSX from 'xlsx'
import * as crypto from 'crypto'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { CreateBankImportDto } from './dto/create-bank-import.dto'
import { BankImportTemplatesService } from '../bank-import-templates/bank-import-templates.service'
import { BankCounterpartyRecognizer } from './bank-counterparty-recognizer.service'
import { DeleteMultipleBankTransactionsDto } from './dto/delete-multiple-bank-transactions.dto'
import { CreateManualBankTransactionDto } from './dto/create-manual-bank-transaction.dto'

type ParsedBankRow = {
    rowNo?: number
    txnDate: Date
    valueDate?: Date
    direction: BankTxnDirection
    amount: number
    description: string
    counterpartyName?: string
    counterpartyAcc?: string
    externalRef?: string

    documentCode?: string
    purposeRaw?: string
    purposeId?: string

    raw: Record<string, any>
}

type PreparedBankRow = ParsedBankRow & {
    purposeId?: string
    fingerprint: string
}

@Injectable()
export class BankingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly bankImportTemplatesService: BankImportTemplatesService,
        private readonly recognizer: BankCounterpartyRecognizer,
    ) {}

    /** Đề xuất đối tượng cho các dòng sao kê đã lưu (khách nào trả, nội bộ, phí…). Không ghi gì. */
    async recognizeTransactions(ids: string[]) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: { id: { in: ids } },
            select: { id: true, bankAccountId: true, direction: true, amount: true, txnDate: true, description: true, counterpartyName: true, counterpartyAcc: true },
        })
        const result = await this.recognizer.recognize(
            rows.map((row) => ({ key: row.id, ...row, amount: Number(row.amount) })),
        )
        const pairs = await this.pairInternalTransfers(rows.filter((row) => result.get(row.id)?.kind === 'INTERNAL'))
        return rows.map((row) => ({ id: row.id, ...result.get(row.id)!, pairedTransaction: pairs.get(row.id) ?? null }))
    }

    /**
     * Chuyển nội bộ luôn có hai đầu: MB chi 450tr thì BIDV nhận 450tr. Tìm dòng đối ứng ở tài khoản
     * công ty khác — ngược chiều, cùng số tiền, lệch không quá 1 ngày — mỗi dòng chỉ ghép một lần.
     */
    private async pairInternalTransfers(rows: { id: string; bankAccountId: string; direction: BankTxnDirection; amount: Prisma.Decimal; txnDate: Date }[]) {
        const pairs = new Map<string, { id: string; bankCode: string; accountNo: string; txnDate: Date; reconciliationStatus: string }>()
        if (!rows.length) return pairs
        const day = 86_400_000
        const times = rows.map((row) => row.txnDate.getTime())
        const candidates = await this.prisma.bankTransaction.findMany({
            where: {
                id: { notIn: rows.map((row) => row.id) },
                amount: { in: [...new Set(rows.map((row) => row.amount.toString()))].map((value) => new Prisma.Decimal(value)) },
                txnDate: { gte: new Date(Math.min(...times) - day), lte: new Date(Math.max(...times) + day) },
            },
            select: {
                id: true,
                bankAccountId: true,
                direction: true,
                amount: true,
                txnDate: true,
                reconciliationStatus: true,
                bankAccount: { select: { bankCode: true, accountNo: true } },
            },
            orderBy: { txnDate: 'asc' },
        })
        const used = new Set<string>()
        // Dòng gần giờ nhất ghép trước, để 16 lệnh 450tr cùng phút không ghép chéo lung tung.
        for (const row of [...rows].sort((a, b) => a.txnDate.getTime() - b.txnDate.getTime())) {
            const best = candidates
                .filter(
                    (candidate) =>
                        !used.has(candidate.id) &&
                        candidate.bankAccountId !== row.bankAccountId &&
                        candidate.direction !== row.direction &&
                        new Prisma.Decimal(candidate.amount).equals(row.amount) &&
                        Math.abs(candidate.txnDate.getTime() - row.txnDate.getTime()) <= day,
                )
                .sort((a, b) => Math.abs(a.txnDate.getTime() - row.txnDate.getTime()) - Math.abs(b.txnDate.getTime() - row.txnDate.getTime()))[0]
            if (!best) continue
            used.add(best.id)
            pairs.set(row.id, {
                id: best.id,
                bankCode: best.bankAccount.bankCode,
                accountNo: best.bankAccount.accountNo,
                txnDate: best.txnDate,
                reconciliationStatus: best.reconciliationStatus,
            })
        }
        return pairs
    }

    /** Bỏ qua nhiều dòng không phải công nợ (chuyển nội bộ, phí/lãi NH); dòng đã phân bổ thì giữ nguyên. */
    async ignoreTransactions(ids: string[], counterpartyType: 'INTERNAL' | 'OTHER', reason?: string) {
        const rows = await this.prisma.bankTransaction.findMany({
            where: { id: { in: ids } },
            select: {
                id: true,
                payableAllocations: { where: { status: PayableAllocationStatus.ACTIVE }, select: { id: true } },
                receivableAllocations: { where: { status: 'ACTIVE' }, select: { id: true } },
                customerReceipt: { select: { id: true } },
            },
        })
        const allowed = rows.filter((row) => !row.payableAllocations.length && !row.receivableAllocations.length && !row.customerReceipt).map((row) => row.id)
        if (allowed.length) {
            await this.prisma.bankTransaction.updateMany({
                where: { id: { in: allowed } },
                data: {
                    matchStatus: BankTxnMatchStatus.IGNORED,
                    reconciliationStatus: 'IGNORED',
                    counterpartyType,
                    ignoredReason: this.cleanOptionalText(reason) ?? (counterpartyType === 'INTERNAL' ? 'Chuyển nội bộ' : null),
                    isConfirmed: true,
                    confirmedAt: new Date(),
                },
            })
        }
        return { ignoredIds: allowed, skippedIds: ids.filter((id) => !allowed.includes(id)) }
    }

    private legacyAllocation(allocation: any) {
        const openItem = allocation.openItem
        return {
            ...allocation,
            allocatedAmount: allocation.amountInBankCurrency,
            settlementId: allocation.openItemId,
            settlement: openItem
                ? {
                      ...openItem,
                      supplierCustomerId: openItem.supplierPartyId,
                      amountTotal: openItem.originalAmount,
                      amountSettled: new Prisma.Decimal(openItem.originalAmount).minus(openItem.outstandingAmount),
                      invoices: openItem.invoice ? [openItem.invoice] : [],
                  }
                : null,
        }
    }

    private transactionResponse(item: any) {
        const payableAllocations = (item.payableAllocations ?? []).map((allocation: any) => this.legacyAllocation(allocation))
        const receivableAllocations = item.receivableAllocations ?? []
        const allocations = item.direction === BankTxnDirection.IN ? receivableAllocations : payableAllocations
        // Tiền ra còn có thể ghép với Mua TM, chi khác, bảng kê TERM — cộng cả vào "đã phân bổ".
        const outgoingMatched =
            item.direction === BankTxnDirection.OUT
                ? (item.commercialPaymentReconciliations ?? []).reduce((sum: number, row: any) => sum + Number(row.amountVnd ?? 0), 0) +
                  (item.generalPaymentReconciliations ?? []).reduce((sum: number, row: any) => sum + Number(row.payment?.amountVnd ?? 0), 0) +
                  (item.termBankInstructions ?? []).reduce((sum: number, row: any) => sum + Number(row.amountVnd ?? 0), 0)
                : 0
        const allocatedAmount =
            allocations
                .filter((allocation: any) => allocation.status === PayableAllocationStatus.ACTIVE || allocation.status === 'ACTIVE')
                .reduce(
                    (sum: number, allocation: any) =>
                        sum + Number(allocation.allocatedAmount ?? allocation.amountInBankCurrency ?? 0),
                    0,
                ) + outgoingMatched
        return {
            ...item,
            allocations,
            payableAllocations,
            receivableAllocations,
            amount: Number(item.amount),
            allocatedAmount,
            remainingAmount: Number(item.amount) - allocatedAmount,
            purposeName: item.purpose?.name ?? null,
            canDelete:
                item.matchStatus === BankTxnMatchStatus.UNMATCHED &&
                item.isConfirmed !== true &&
                allocations.length === 0,
        }
    }

    async listTransactions(query: QueryBankTransactionsDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 20
        const skip = (page - 1) * pageSize

        const where: Prisma.BankTransactionWhereInput = {
            ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
            ...(query.direction ? { direction: query.direction as BankTxnDirection } : {}),
            ...(query.matchStatus ? { matchStatus: query.matchStatus as BankTxnMatchStatus } : {}),
            ...(query.reconciliationStatus ? { reconciliationStatus: query.reconciliationStatus as any } : {}),
            ...(query.confirmed === 'true' ? { isConfirmed: true } : query.confirmed === 'false' ? { isConfirmed: false } : {}),
            ...(query.fromDate || query.toDate
                ? {
                      txnDate: {
                          ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
                          ...(query.toDate ? { lte: new Date(query.toDate) } : {}),
                      },
                  }
                : {}),
            ...(query.keyword
                ? {
                      OR: [
                          { description: { contains: query.keyword, mode: 'insensitive' } },
                          { counterpartyName: { contains: query.keyword, mode: 'insensitive' } },
                          { counterpartyAcc: { contains: query.keyword, mode: 'insensitive' } },
                          { externalRef: { contains: query.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.bankTransaction.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
                include: {
                    bankAccount: true,
                    purpose: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                        },
                    },
                    payableAllocations: {
                        include: {
                            openItem: {
                                include: {
                                    invoice: {
                                        select: {
                                            id: true,
                                            invoiceNo: true,
                                            invoiceSymbol: true,
                                            invoiceDate: true,
                                        },
                                    },
                                    supplier: {
                                        select: {
                                            id: true,
                                            code: true,
                                            name: true,
                                        },
                                    },
                                },
                            },
                        },
                        orderBy: { allocatedAt: 'asc' },
                    },
                    receivableAllocations: {
                        include: {
                            openItem: {
                                include: {
                                    customer: { select: { id: true, code: true, name: true } },
                                    salesOrder: { select: { id: true, orderNo: true } },
                                    salesInvoice: { select: { id: true, invoiceNoInternal: true, misaInvoiceNo: true } },
                                },
                            },
                        },
                        orderBy: { allocatedAt: 'asc' },
                    },
                    // Các kiểu ghép tiền ra khác ngoài công nợ NCC, để cột "đã phân bổ" tính đủ.
                    commercialPaymentReconciliations: { where: { reversedAt: null }, select: { amountVnd: true } },
                    generalPaymentReconciliations: { where: { reversedAt: null }, select: { payment: { select: { amountVnd: true } } } },
                    termBankInstructions: { where: { status: { not: 'CANCELLED' } }, select: { amountVnd: true } },
                },
            }),
            this.prisma.bankTransaction.count({ where }),
        ])

        const data = items.map((item) => this.transactionResponse(item))

        return {
            data,
            meta: {
                page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize),
            },
        }
    }

    async remove(id: string) {
        const item = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: {
                payableAllocations: {
                    select: { id: true },
                    take: 1,
                },
                receivableAllocations: {
                    select: { id: true },
                    take: 1,
                },
            },
        })

        if (!item) {
            throw new NotFoundException('Không tìm thấy giao dịch ngân hàng')
        }

        if (
            item.source !== BankTransactionSource.MANUAL ||
            item.matchStatus !== BankTxnMatchStatus.UNMATCHED ||
            item.isConfirmed ||
            item.payableAllocations.length > 0 ||
            item.receivableAllocations.length > 0
        ) {
            throw new BadRequestException('Chỉ được xóa giao dịch nhập tay, chưa khớp và chưa xác nhận')
        }

        await this.prisma.bankTransaction.delete({
            where: { id },
        })

        return { success: true }
    }

    async deleteMultiple(dto: DeleteMultipleBankTransactionsDto) {
        const items = await this.prisma.bankTransaction.findMany({
            where: { id: { in: dto.ids } },
            select: {
                id: true,
                source: true,
                matchStatus: true,
                isConfirmed: true,
                payableAllocations: {
                    select: { id: true },
                    take: 1,
                },
                receivableAllocations: {
                    select: { id: true },
                    take: 1,
                },
            },
        })

        if (items.length !== dto.ids.length) {
            throw new NotFoundException('Một hoặc nhiều giao dịch không tồn tại')
        }

        const invalid = items.filter(
            (x) =>
                x.matchStatus !== BankTxnMatchStatus.UNMATCHED ||
                x.isConfirmed ||
                x.source !== BankTransactionSource.MANUAL ||
                x.payableAllocations.length > 0 ||
                x.receivableAllocations.length > 0,
        )

        if (invalid.length > 0) {
            throw new BadRequestException('Danh sách có giao dịch đã khớp hoặc đã xác nhận, không thể xóa')
        }

        const result = await this.prisma.bankTransaction.deleteMany({
            where: {
                id: { in: dto.ids },
            },
        })

        return {
            success: true,
            count: result.count,
        }
    }

    async getTransactionDetail(id: string) {
        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: {
                bankAccount: true,
                purpose: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                    },
                },
                payableAllocations: {
                    include: {
                        openItem: {
                            include: {
                                invoice: true,
                                supplier: {
                                    select: { id: true, code: true, name: true },
                                },
                            },
                        },
                    },
                    orderBy: { allocatedAt: 'asc' },
                },
                receivableAllocations: {
                    include: {
                        openItem: {
                            include: {
                                customer: { select: { id: true, code: true, name: true } },
                                salesOrder: { select: { id: true, orderNo: true } },
                                salesInvoice: { select: { id: true, invoiceNoInternal: true, misaInvoiceNo: true } },
                            },
                        },
                    },
                    orderBy: { allocatedAt: 'asc' },
                },
            },
        })

        if (!txn) {
            throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        }

        return this.transactionResponse(txn)
    }

    async getMatchSuggestions(id: string) {
        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: {
                payableAllocations: true,
                purpose: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                    },
                },
            },
        })

        if (!txn) {
            throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        }

        const allocatedAmount = txn.payableAllocations
            .filter((allocation) => allocation.status === PayableAllocationStatus.ACTIVE)
            .reduce((sum, allocation) => sum + Number(allocation.amountInBankCurrency), 0)
        const remainingAmount = Number(txn.amount) - allocatedAmount

        if (txn.documentCode) {

            const purchaseOrder = await this.prisma.purchaseOrder.findFirst({
                where: {
                    orderNo: txn.documentCode,
                },
                select: {
                    id: true,
                    orderNo: true,
                    paymentPlans: {
                        orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }],
                        select: {
                            id: true,
                            amount: true,
                            dueDate: true,
                            sortOrder: true,
                        },
                    },
                },
            })

            if (purchaseOrder) {
                const settlements = await this.prisma.payableOpenItem.findMany({
                    where: {
                        status: {
                            in: [PayableOpenItemStatus.OPEN, PayableOpenItemStatus.PARTIALLY_SETTLED],
                        },
                        invoice: { purchaseOrderId: purchaseOrder.id },
                    },
                    include: {
                        supplier: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                                taxCode: true,
                            },
                        },
                        invoice: {
                            select: {
                                id: true,
                                invoiceNo: true,
                                invoiceSymbol: true,
                                invoiceDate: true,
                                totalAmount: true,
                            },
                        },
                    },
                    orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
                })

                if (settlements.length > 0) {
                    const suggestions = settlements
                        .map((s) => {
                            const settlementRemaining = Number(s.outstandingAmount)
                            if (settlementRemaining <= 0) return null

                            let score = 100

                            if (Math.abs(remainingAmount - settlementRemaining) <= 0.0001) {
                                score = 100
                            } else {
                                const diff = Math.abs(remainingAmount - settlementRemaining)
                                if (diff <= 1000) score = 96
                                else {
                                    const ratio = Math.min(remainingAmount, settlementRemaining) / Math.max(remainingAmount, settlementRemaining)
                                    if (ratio >= 0.95) score = 90
                                    else if (ratio >= 0.8) score = 82
                                    else score = 72
                                }
                            }

                            const matchedPaymentPlan = purchaseOrder.paymentPlans.find((p) => Math.abs(Number(p.amount) - remainingAmount) <= 0.0001) ?? null

                            if (matchedPaymentPlan) {
                                score = Math.max(score, 98)
                            }

                            return {
                                settlementId: s.id,
                                purchaseOrderId: purchaseOrder.id,
                                purchaseOrderNo: purchaseOrder.orderNo,
                                paymentPlanId: matchedPaymentPlan?.id ?? null,
                                supplier: s.supplier,
                                invoices: s.invoice
                                    ? [{ ...s.invoice, totalAmount: Number(s.invoice.totalAmount) }]
                                    : [],
                                amountTotal: Number(s.originalAmount),
                                amountSettled: Number(s.originalAmount.minus(s.outstandingAmount)),
                                remainingAmount: settlementRemaining,
                                dueDate: s.dueDate,
                                score,
                                suggestedAllocatedAmount: this.computeSuggestedAllocatedAmount(remainingAmount, settlementRemaining),
                                matchedBy: 'DOCUMENT_CODE',
                            }
                        })
                        .filter(Boolean)
                        .sort((a: any, b: any) => {
                            if (b.score !== a.score) return b.score - a.score
                            const aDiff = Math.abs(remainingAmount - a.remainingAmount)
                            const bDiff = Math.abs(remainingAmount - b.remainingAmount)
                            return aDiff - bDiff
                        })

                    return {
                        transaction: {
                            id: txn.id,
                            amount: Number(txn.amount),
                            direction: txn.direction,
                            description: txn.description,
                            counterpartyName: txn.counterpartyName,
                            counterpartyAcc: txn.counterpartyAcc,
                            documentCode: txn.documentCode,
                            purposeRaw: txn.purposeRaw,
                            purposeId: txn.purposeId,
                            purposeName: txn.purpose?.name ?? null,
                            allocatedAmount,
                            remainingAmount,
                        },
                        suggestions,
                    }
                }
            }
        }

        // fallback logic cũ
        const settlements = await this.prisma.payableOpenItem.findMany({
            where: {
                status: {
                    in: [PayableOpenItemStatus.OPEN, PayableOpenItemStatus.PARTIALLY_SETTLED],
                },
                ...(txn.direction === BankTxnDirection.OUT ? {} : { settlementType: 'ADVANCE' }),
            },
            include: {
                supplier: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                        taxCode: true,
                        bankAccounts: { where: { isActive: true }, select: { accountNo: true } },
                    },
                },
                invoice: {
                    select: {
                        id: true,
                        invoiceNo: true,
                        invoiceSymbol: true,
                        invoiceDate: true,
                        totalAmount: true,
                    },
                },
            },
            orderBy: [{ dueDate: 'asc' }, { createdAt: 'asc' }],
            take: 50,
        })

        const normalizedDesc = this.normalizeText(txn.description)
        const normalizedCounterpartyName = this.normalizeText(txn.counterpartyName)
        const txnDate = txn.txnDate ? new Date(txn.txnDate) : undefined

        const suggestions = settlements
            .map((s) => {
                const remainingSettlement = Number(s.outstandingAmount)

                if (remainingSettlement <= 0) return null

                const score = this.computeSettlementMatchScore({
                    txnAmount: Number(txn.amount),
                    txnRemainingAmount: remainingAmount,
                    txnDate,
                    txnDescription: normalizedDesc,
                    txnCounterpartyName: normalizedCounterpartyName,
                    txnCounterpartyAcc: txn.counterpartyAcc,
                    settlementRemainingAmount: remainingSettlement,
                    supplierName: s.supplier?.name,
                    supplierBankAccounts: s.supplier?.bankAccounts.map((a) => a.accountNo) ?? [],
                    invoices: s.invoice
                        ? [
                              {
                                  invoiceNo: s.invoice.invoiceNo,
                                  invoiceSymbol: s.invoice.invoiceSymbol,
                                  invoiceDate: s.invoice.invoiceDate,
                              },
                          ]
                        : [],
                })

                return {
                    settlementId: s.id,
                    supplier: s.supplier,
                    invoices: s.invoice
                        ? [{ ...s.invoice, totalAmount: Number(s.invoice.totalAmount) }]
                        : [],
                    amountTotal: Number(s.originalAmount),
                    amountSettled: Number(s.originalAmount.minus(s.outstandingAmount)),
                    remainingAmount: remainingSettlement,
                    dueDate: s.dueDate,
                    score,
                    suggestedAllocatedAmount: this.computeSuggestedAllocatedAmount(remainingAmount, remainingSettlement),
                    matchedBy: 'FALLBACK_SCORE',
                }
            })
            .filter(Boolean)
            .sort((a: any, b: any) => {
                if (b.score !== a.score) return b.score - a.score

                const aDiff = Math.abs(remainingAmount - a.remainingAmount)
                const bDiff = Math.abs(remainingAmount - b.remainingAmount)

                return aDiff - bDiff
            })

        return {
            transaction: {
                id: txn.id,
                amount: Number(txn.amount),
                direction: txn.direction,
                description: txn.description,
                counterpartyName: txn.counterpartyName,
                counterpartyAcc: txn.counterpartyAcc,
                documentCode: txn.documentCode,
                purposeRaw: txn.purposeRaw,
                purposeId: txn.purposeId,
                purposeName: txn.purpose?.name ?? null,
                allocatedAmount,
                remainingAmount,
            },
            suggestions,
        }
    }

    async confirmTransaction(id: string, body: ConfirmBankTransactionDto) {
        const totalAllocated = body.allocations.reduce((sum, item) => sum + Number(item.allocatedAmount), 0)
        if (totalAllocated <= 0) throw new BadRequestException('TOTAL_ALLOCATED_MUST_BE_GT_ZERO')
        const seen = new Set<string>()
        for (const item of body.allocations) {
            if (seen.has(item.settlementId)) {
                throw new BadRequestException('DUPLICATE_SETTLEMENT_ALLOCATION')
            }
            seen.add(item.settlementId)
        }
        await this.prisma.$transaction(async (tx) => {
            const lockKeys = [`bank:${id}`, ...[...seen].map((openItemId) => `ap:${openItemId}`)].sort()
            for (const key of lockKeys) {
                await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
            }
            const transaction = await tx.bankTransaction.findUnique({
                where: { id },
                include: {
                    bankAccount: true,
                    payableAllocations: { where: { status: PayableAllocationStatus.ACTIVE } },
                },
            })
            if (!transaction) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
            if (transaction.isConfirmed) throw new BadRequestException('BANK_TRANSACTION_ALREADY_CONFIRMED')
            if (transaction.direction !== BankTxnDirection.OUT) {
                throw new BadRequestException('ONLY_OUT_TRANSACTION_SUPPORTED')
            }
            const alreadyAllocated = transaction.payableAllocations.reduce(
                (sum, allocation) => sum.plus(allocation.amountInBankCurrency),
                new Prisma.Decimal(0),
            )
            if (alreadyAllocated.plus(totalAllocated).greaterThan(transaction.amount)) {
                throw new BadRequestException('ALLOCATED_EXCEEDS_TRANSACTION_AMOUNT')
            }

            for (const input of body.allocations) {
                const openItem = await tx.payableOpenItem.findUnique({ where: { id: input.settlementId } })
                if (!openItem) throw new BadRequestException('SETTLEMENT_NOT_FOUND')
                if (
                    openItem.status !== PayableOpenItemStatus.OPEN &&
                    openItem.status !== PayableOpenItemStatus.PARTIALLY_SETTLED
                ) {
                    throw new BadRequestException(`INVALID_SETTLEMENT_STATUS:${openItem.id}`)
                }
                if (openItem.currency !== transaction.bankAccount.currency) {
                    throw new BadRequestException(`PAYMENT_CURRENCY_MISMATCH:${openItem.id}`)
                }
                const amount = new Prisma.Decimal(input.allocatedAmount)
                if (amount.greaterThan(openItem.outstandingAmount)) {
                    throw new BadRequestException(`ALLOCATED_EXCEEDS_SETTLEMENT_REMAINING:${openItem.id}`)
                }
                const allocation = await tx.payableAllocation.create({
                    data: {
                        bankTransactionId: transaction.id,
                        openItemId: openItem.id,
                        amountInBankCurrency: amount,
                        amountInItemCurrency: amount,
                        fxRate: 1,
                        idempotencyKey: `bank-confirm:${transaction.id}:${openItem.id}`,
                        allocatedAt: new Date(),
                    },
                })
                await tx.payableLedgerEntry.create({
                    data: {
                        openItemId: openItem.id,
                        type: PayableEntryType.PAYMENT,
                        amountDelta: amount.negated(),
                        allocationId: allocation.id,
                        idempotencyKey: `bank-confirm:${transaction.id}:${openItem.id}:ledger`,
                        effectiveAt: allocation.allocatedAt,
                    },
                })
                const outstandingAmount = new Prisma.Decimal(openItem.outstandingAmount).minus(amount)
                await tx.payableOpenItem.update({
                    where: { id: openItem.id },
                    data: {
                        outstandingAmount,
                        status: outstandingAmount.isZero()
                            ? PayableOpenItemStatus.SETTLED
                            : PayableOpenItemStatus.PARTIALLY_SETTLED,
                        version: { increment: 1 },
                    },
                })
            }
            await tx.bankTransaction.update({
                where: { id: transaction.id },
                data: {
                    matchStatus: alreadyAllocated.plus(totalAllocated).greaterThanOrEqualTo(transaction.amount)
                        ? BankTxnMatchStatus.MANUAL_MATCHED
                        : BankTxnMatchStatus.PARTIAL_MATCHED,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                },
            })
        })
        return this.getTransactionDetail(id)
    }

    /** Keep the immutable bank row, but explicitly exclude a non-business receipt from AR/AP. */
    async ignoreTransaction(id: string, reason?: string) {
        const item = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: {
                payableAllocations: { where: { status: PayableAllocationStatus.ACTIVE }, select: { id: true } },
                receivableAllocations: { where: { status: 'ACTIVE' }, select: { id: true } },
            },
        })
        if (!item) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (item.payableAllocations.length || item.receivableAllocations.length) {
            throw new BadRequestException('BANK_TRANSACTION_HAS_ALLOCATIONS')
        }
        return this.prisma.bankTransaction.update({
            where: { id },
            data: {
                matchStatus: BankTxnMatchStatus.IGNORED,
                reconciliationStatus: 'IGNORED',
                ignoredReason: this.cleanOptionalText(reason) ?? null,
                isConfirmed: true,
                confirmedAt: new Date(),
            },
        })
    }

    /** Dòng bị bỏ qua nhầm (tưởng nội bộ / phí): đưa lại về hàng đợi để xử lý lại. */
    async restoreTransaction(id: string) {
        const item = await this.prisma.bankTransaction.findUnique({ where: { id }, select: { reconciliationStatus: true } })
        if (!item) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (item.reconciliationStatus !== 'IGNORED') {
            throw new BadRequestException({ code: 'BANK_TRANSACTION_NOT_IGNORED', message: 'Giao dịch này không ở trạng thái bỏ qua.' })
        }
        return this.prisma.bankTransaction.update({
            where: { id },
            data: {
                matchStatus: BankTxnMatchStatus.UNMATCHED,
                reconciliationStatus: 'PENDING',
                ignoredReason: null,
                counterpartyType: null,
                counterpartyId: null,
                isConfirmed: false,
                confirmedAt: null,
                confirmedBy: null,
            },
        })
    }

    async listTemplates(bankCode?: string) {
        return this.bankImportTemplatesService.listActive(bankCode)
    }

    async createManualTransaction(body: CreateManualBankTransactionDto) {
        const bankAccount = await this.prisma.bankAccount.findUnique({
            where: { id: body.bankAccountId },
        })

        if (!bankAccount) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        const description = this.cleanOptionalText(body.description)
        if (!description) {
            throw new BadRequestException('DESCRIPTION_REQUIRED')
        }

        const txnDate = this.toDateOnly(body.txnDate)
        const direction = body.direction as BankTxnDirection
        const amount = Number(body.amount || 0)
        const documentCode = this.cleanOptionalText(body.documentCode)?.toUpperCase()
        const externalRef = this.cleanOptionalText(body.externalRef)
        const counterpartyAcc = this.cleanOptionalText(body.counterpartyAcc)

        const fingerprint = this.buildTxnFingerprint({
            bankAccountId: body.bankAccountId,
            txnDate,
            direction,
            amount,
            description,
            counterpartyAcc,
            externalRef,
            documentCode,
        })

        const existed = await this.prisma.bankTransaction.findFirst({
            where: {
                bankAccountId: body.bankAccountId,
                OR: [...(externalRef ? [{ externalRef }] : []), { fingerprint }],
            },
            select: { id: true },
        })

        if (existed) {
            throw new BadRequestException('BANK_TRANSACTION_DUPLICATED')
        }

        const txn = await this.prisma.bankTransaction.create({
            data: {
                bankAccountId: body.bankAccountId,
                txnDate,
                valueDate: txnDate,
                direction,
                amount: new Prisma.Decimal(amount),
                source: BankTransactionSource.MANUAL,
                receivedAt: new Date(),
                description,
                counterpartyName: this.cleanOptionalText(body.counterpartyName) ?? null,
                counterpartyAcc: counterpartyAcc ?? null,
                externalRef: externalRef ?? null,
                documentCode: documentCode ?? null,
                purposeRaw: this.cleanOptionalText(body.purposeRaw) ?? null,
                purposeId: body.purposeId ?? null,
                note: this.cleanOptionalText(body.note) ?? null,
                fingerprint,
                matchStatus: BankTxnMatchStatus.UNMATCHED,
                raw: {
                    source: 'manual',
                    enteredAt: new Date().toISOString(),
                },
            },
        })

        return this.getTransactionDetail(txn.id)
    }

    async getImportDetail(id: string) {
        const item = await this.prisma.bankStatementImport.findUnique({
            where: { id },
            include: {
                bankAccount: true,
                template: true,
                bankTransactions: {
                    orderBy: [{ txnDate: 'desc' }, { createdAt: 'desc' }],
                    take: 20,
                },
            },
        })

        if (!item) {
            throw new NotFoundException('BANK_IMPORT_NOT_FOUND')
        }

        return item
    }

    async previewImportStatement(file: Express.Multer.File, body: CreateBankImportDto) {
        if (!file) {
            throw new BadRequestException('FILE_REQUIRED')
        }

        if (!this.isSupportedStatementFile(file.originalname)) {
            throw new BadRequestException('ONLY_XLSX_OR_HTML_XLS_SUPPORTED')
        }

        const bankAccount = await this.prisma.bankAccount.findUnique({
            where: { id: body.bankAccountId },
        })

        if (!bankAccount) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        const template = await this.resolveImportTemplate(bankAccount.bankCode, body.templateId)
        const checksum = this.sha256(file.buffer)
        const existedImport = await this.prisma.bankStatementImport.findFirst({
            where: {
                bankAccountId: body.bankAccountId,
                fileChecksum: checksum,
            },
            select: {
                id: true,
                createdAt: true,
            },
        })

        const parsed = await this.parseBankStatementFile(file, template?.columnMap, template?.normalizeRule)
        const prepared = await this.prepareBankRows(body.bankAccountId, parsed.rows)
        const duplicateFlags = await this.detectDuplicateFlags(body.bankAccountId, prepared)

        const allRows = prepared.map((row) => ({
            rowNo: row.rowNo ?? 0,
            txnDate: row.txnDate,
            valueDate: row.valueDate ?? null,
            direction: row.direction,
            amount: row.amount,
            description: row.description,
            counterpartyName: row.counterpartyName ?? null,
            counterpartyAcc: row.counterpartyAcc ?? null,
            externalRef: row.externalRef ?? null,
            documentCode: row.documentCode ?? null,
            purposeRaw: row.purposeRaw ?? null,
            fingerprint: row.fingerprint,
            isDuplicate: duplicateFlags.has(row.fingerprint) || (!!row.externalRef && duplicateFlags.has(`ref:${row.externalRef}`)),
            raw: row.raw,
        }))
        const rows = allRows.slice(0, 500)

        const duplicatedCount = allRows.filter((row) => row.isDuplicate).length

        // Nhận diện ngay ở bước xem trước để người import thấy dòng nào đã rõ đối tượng.
        const recognition = await this.recognizer.recognize(
            rows.map((row) => ({
                key: String(row.rowNo),
                bankAccountId: body.bankAccountId,
                direction: row.direction,
                amount: row.amount,
                txnDate: row.txnDate,
                description: row.description,
                counterpartyName: row.counterpartyName,
                counterpartyAcc: row.counterpartyAcc,
            })),
        )
        const recognizedRows = rows.map((row) => ({ ...row, recognition: recognition.get(String(row.rowNo)) ?? null }))
        const kindCount = (kind: string, direction?: BankTxnDirection) =>
            recognizedRows.filter((row) => !row.isDuplicate && row.recognition?.kind === kind && (!direction || row.direction === direction)).length

        return {
            fileName: file.originalname,
            fileChecksum: checksum,
            existedImport,
            bankAccount: {
                id: bankAccount.id,
                bankCode: bankAccount.bankCode,
                accountNo: bankAccount.accountNo,
                accountName: bankAccount.accountName,
            },
            template: template
                ? {
                      id: template.id,
                      bankCode: template.bankCode,
                      name: template.name,
                      version: template.version,
                  }
                : null,
            summary: {
                totalRows: prepared.length,
                previewCount: rows.length,
                validCount: prepared.length - duplicatedCount,
                duplicatedCount,
                inCount: recognizedRows.filter((row) => !row.isDuplicate && row.direction === BankTxnDirection.IN).length,
                outCount: recognizedRows.filter((row) => !row.isDuplicate && row.direction === BankTxnDirection.OUT).length,
                customerRecognizedCount: recognizedRows.filter(
                    (row) => !row.isDuplicate && row.direction === BankTxnDirection.IN && row.recognition?.kind === 'CUSTOMER' && row.recognition.party,
                ).length,
                customerHighCount: recognizedRows.filter(
                    (row) => !row.isDuplicate && row.recognition?.kind === 'CUSTOMER' && row.recognition.confidence === 'HIGH',
                ).length,
                internalCount: kindCount('INTERNAL'),
                bankFeeCount: kindCount('BANK_FEE'),
                undeclaredCompanyAccounts: [...new Set(recognizedRows.map((row) => row.recognition?.undeclaredCompanyAccount).filter(Boolean))],
            },
            rows: recognizedRows,
        }
    }

    async importStatement(file: Express.Multer.File, body: CreateBankImportDto) {
        if (!file) {
            throw new BadRequestException('FILE_REQUIRED')
        }

        if (!this.isSupportedStatementFile(file.originalname)) {
            throw new BadRequestException('ONLY_XLSX_OR_HTML_XLS_SUPPORTED')
        }

        const bankAccount = await this.prisma.bankAccount.findUnique({
            where: { id: body.bankAccountId },
        })

        if (!bankAccount) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        const template = await this.resolveImportTemplate(bankAccount.bankCode, body.templateId)

        const checksum = this.sha256(file.buffer)

        const existedImport = await this.prisma.bankStatementImport.findFirst({
            where: {
                bankAccountId: body.bankAccountId,
                fileChecksum: checksum,
            },
        })

        if (existedImport) {
            throw new BadRequestException('BANK_IMPORT_FILE_ALREADY_IMPORTED')
        }

        const importJob = await this.prisma.bankStatementImport.create({
            data: {
                bankAccountId: body.bankAccountId,
                templateId: template?.id ?? null,
                status: BankImportStatus.PROCESSING,
                fileUrl: file.originalname,
                fileChecksum: checksum,
                startedAt: new Date(),
                createdBy: null,
            },
        })

        try {
            const parsed = await this.parseBankStatementFile(file, template?.columnMap, template?.normalizeRule)

            if (!parsed.rows.length) {
                throw new BadRequestException('BANK_IMPORT_NO_VALID_ROWS')
            }

            const prepared = await this.prepareBankRows(body.bankAccountId, parsed.rows)

            const externalRefs = prepared.map((x) => x.externalRef).filter((x): x is string => !!x)

            const fingerprints = prepared.map((x) => x.fingerprint)

            const existingTxns = await this.prisma.bankTransaction.findMany({
                where: {
                    bankAccountId: body.bankAccountId,
                    OR: [...(externalRefs.length ? [{ externalRef: { in: externalRefs } }] : []), { fingerprint: { in: fingerprints } }],
                },
                select: {
                    externalRef: true,
                    fingerprint: true,
                },
            })

            const existingExternalRefSet = new Set(existingTxns.map((x) => x.externalRef).filter((x): x is string => !!x))

            const existingFingerprintSet = new Set(existingTxns.map((x) => x.fingerprint))

            const toInsert: typeof prepared = []
            let duplicatedCount = 0
            let failedCount = 0

            for (const row of prepared) {
                try {
                    const isDuplicate = (row.externalRef && existingExternalRefSet.has(row.externalRef)) || existingFingerprintSet.has(row.fingerprint)

                    if (isDuplicate) {
                        duplicatedCount++
                        continue
                    }

                    toInsert.push(row)
                } catch {
                    failedCount++
                }
            }

            const BATCH_SIZE = 200
            let importedCount = 0

            for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
                const chunk = toInsert.slice(i, i + BATCH_SIZE)

                await this.prisma.bankTransaction.createMany({
                    data: chunk.map((row) => ({
                        bankAccountId: body.bankAccountId,
                        importId: importJob.id,
                        txnDate: row.txnDate,
                        valueDate: row.valueDate ?? row.txnDate,
                        direction: row.direction,
                        amount: new Prisma.Decimal(row.amount),
                        source: BankTransactionSource.EXCEL,
                        receivedAt: new Date(),
                        description: row.description,
                        counterpartyName: row.counterpartyName ?? null,
                        counterpartyAcc: row.counterpartyAcc ?? null,
                        externalRef: row.externalRef ?? null,
                        documentCode: row.documentCode ?? null,
                        purposeRaw: row.purposeRaw ?? null,
                        purposeId: row.purposeId ?? null,
                        fingerprint: row.fingerprint,
                        matchStatus: BankTxnMatchStatus.UNMATCHED,
                        raw: row.raw,
                    })),
                    skipDuplicates: true,
                })

                importedCount += chunk.length
            }

            const t1 = Date.now()

            await this.prisma.bankStatementImport.update({
                where: { id: importJob.id },
                data: {
                    status: BankImportStatus.DONE,
                    finishedAt: new Date(),
                    importedCount,
                    duplicatedCount,
                    failedCount,
                },
            })

            return this.getImportDetail(importJob.id)
        } catch (error: any) {
            await this.prisma.bankStatementImport.update({
                where: { id: importJob.id },
                data: {
                    status: BankImportStatus.FAILED,
                    finishedAt: new Date(),
                    errorMessage: error?.message || 'IMPORT_FAILED',
                },
            })

            throw error
        }
    }

    private isSupportedStatementFile(fileName: string) {
        const lower = fileName.toLowerCase()
        return lower.endsWith('.xlsx') || lower.endsWith('.xls')
    }

    private async parseBankStatementFile(
        file: Express.Multer.File,
        columnMapRaw?: Prisma.JsonValue | null,
        normalizeRuleRaw?: Prisma.JsonValue | null,
    ): Promise<{ rows: ParsedBankRow[] }> {
        if (file.originalname.toLowerCase().endsWith('.xls')) {
            const html = Buffer.from(file.buffer).toString('utf8')
            if (/<html\b|<table\b/i.test(html)) {
                return this.parseTableRows(this.extractHtmlTableRows(html), columnMapRaw, normalizeRuleRaw)
            }
            // .xls nhị phân (Excel 97-2003) — VietinBank eFAST xuất đúng dạng này.
            return this.parseTableRows(this.extractBinaryXlsRows(file.buffer, columnMapRaw), columnMapRaw, normalizeRuleRaw)
        }

        return this.parseXlsxWithExcelJS(file.buffer, columnMapRaw, normalizeRuleRaw)
    }

    private async parseXlsxWithExcelJS(
        buffer: Buffer | Uint8Array | ArrayBuffer,
        columnMapRaw?: Prisma.JsonValue | null,
        normalizeRuleRaw?: Prisma.JsonValue | null,
    ): Promise<{ rows: ParsedBankRow[] }> {
        const workbook = new ExcelJS.Workbook()
        const data = Buffer.from(buffer as any)
        await workbook.xlsx.load(data as any)

        const columnMap = (columnMapRaw || {}) as Record<string, any>
        const normalizeRule = (normalizeRuleRaw || {}) as Record<string, any>

        const worksheet = columnMap.sheetName ? workbook.getWorksheet(columnMap.sheetName) : workbook.worksheets[0]

        if (!worksheet) {
            throw new BadRequestException('BANK_IMPORT_SHEET_NOT_FOUND')
        }

        const headerRowIndex = Number(columnMap.headerRow || 1)
        const headerRow = worksheet.getRow(headerRowIndex)

        const columnIndexMap: Record<string, number> = {}
        headerRow.eachCell((cell, colNumber) => {
            const header = String(this.extractExcelCellValue(cell.value) ?? '').trim()
            if (header) {
                columnIndexMap[header] = colNumber
            }
        })

        this.assertRequiredImportColumns(columnMap, columnIndexMap)

        const getCell = (row: ExcelJS.Row, key: string) => {
            const header = columnMap[key]
            if (!header) return null

            const colIndex = columnIndexMap[String(header).trim()]
            if (!colIndex) return null

            return this.extractExcelCellValue(row.getCell(colIndex).value)
        }

        const result: ParsedBankRow[] = []

        worksheet.eachRow((row, rowNumber) => {
            if (rowNumber <= headerRowIndex) return

            const mapped = {
                date: getCell(row, 'date'),
                valueDate: getCell(row, 'valueDate'),
                description: getCell(row, 'description'),
                amount: getCell(row, 'amount'),
                credit: getCell(row, 'credit'),
                debit: getCell(row, 'debit'),
                direction: getCell(row, 'direction'),
                counterpartyName: getCell(row, 'counterpartyName'),
                counterpartyAcc: getCell(row, 'counterpartyAcc'),
                externalRef: getCell(row, 'externalRef'),
                documentCode: getCell(row, 'documentCode'),
                purpose: getCell(row, 'purpose'),
                balance: getCell(row, 'balance'),
            }

            if (this.isEmptyMappedRow(mapped)) {
                if (normalizeRule.skipEmptyRows !== false) return
            }

            const txnDate = this.parseTxnDate(mapped.date)
            const valueDate = this.parseTxnDate(mapped.valueDate)
            const normalized = this.parseAmountAndDirection(mapped.amount, mapped.credit, mapped.debit, mapped.direction, normalizeRule)
            const description = this.cleanOptionalText(mapped.description)

            if (!txnDate || !normalized || !description) {
                return
            }

            const documentCode = this.cleanOptionalText(mapped.documentCode)?.toUpperCase()
            const purposeRaw = this.cleanOptionalText(mapped.purpose)

            result.push({
                rowNo: rowNumber,
                txnDate,
                valueDate: valueDate ?? undefined,
                direction: normalized.direction,
                amount: normalized.amount,
                description,
                counterpartyName: this.cleanOptionalText(mapped.counterpartyName),
                counterpartyAcc: this.cleanOptionalText(mapped.counterpartyAcc),
                externalRef: this.cleanOptionalText(mapped.externalRef),
                documentCode,
                purposeRaw,
                raw: mapped,
            })
        })

        return { rows: result }
    }

    /** Đọc sheet của file .xls nhị phân thành mảng dòng chữ, cùng dạng với bảng HTML. */
    private extractBinaryXlsRows(buffer: Buffer | Uint8Array, columnMapRaw?: Prisma.JsonValue | null): string[][] {
        const columnMap = (columnMapRaw || {}) as Record<string, any>
        let workbook: XLSX.WorkBook
        try {
            workbook = XLSX.read(Buffer.from(buffer), { type: 'buffer', cellDates: false })
        } catch {
            throw new BadRequestException('BINARY_XLS_UNREADABLE')
        }
        const sheetName = columnMap.sheetName && workbook.SheetNames.includes(columnMap.sheetName) ? columnMap.sheetName : workbook.SheetNames[0]
        const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
        if (!sheet) throw new BadRequestException('BANK_IMPORT_SHEET_NOT_FOUND')
        // raw: false → lấy đúng chữ đang hiện trên file (ngày, số có dấu phẩy); blankrows giữ
        // nguyên số thứ tự dòng để headerRow trong mẫu trùng với số dòng trên Excel.
        const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: '', blankrows: true })
        return rows.map((row) => row.map((cell) => String(cell ?? '')))
    }

    /** Tiêu đề cột so theo chữ đã gộp khoảng trắng: file ngân hàng hay xuống dòng giữa tiêu đề. */
    private normalizeHeader(value: unknown) {
        return String(value ?? '').replace(/\s+/g, ' ').trim()
    }

    /** Bộ đọc chung cho mọi file dạng bảng chữ (.xls HTML của VCB, .xls nhị phân của VietinBank). */
    private parseTableRows(
        tableRows: string[][],
        columnMapRaw?: Prisma.JsonValue | null,
        normalizeRuleRaw?: Prisma.JsonValue | null,
    ): { rows: ParsedBankRow[] } {
        const columnMap = (columnMapRaw || {}) as Record<string, any>
        const normalizeRule = (normalizeRuleRaw || {}) as Record<string, any>
        const headerRowIndex = Number(columnMap.headerRow || 1)
        const headerRow = tableRows[headerRowIndex - 1]

        if (!headerRow) {
            throw new BadRequestException('BANK_IMPORT_HEADER_ROW_NOT_FOUND')
        }

        const columnIndexMap: Record<string, number> = {}
        headerRow.forEach((header, index) => {
            const text = this.normalizeHeader(header)
            if (text && columnIndexMap[text] === undefined) columnIndexMap[text] = index
        })

        this.assertRequiredImportColumns(
            Object.fromEntries(Object.entries(columnMap).map(([key, value]) => [key, typeof value === 'string' ? this.normalizeHeader(value) : value])),
            columnIndexMap,
        )

        const getCell = (row: string[], key: string) => {
            const header = columnMap[key]
            if (!header) return null
            const colIndex = columnIndexMap[this.normalizeHeader(header)]
            return colIndex === undefined ? null : row[colIndex]
        }

        const result: ParsedBankRow[] = []
        tableRows.slice(headerRowIndex).forEach((row, offset) => {
            const mapped = {
                date: getCell(row, 'date'),
                valueDate: getCell(row, 'valueDate'),
                description: getCell(row, 'description'),
                amount: getCell(row, 'amount'),
                credit: getCell(row, 'credit'),
                debit: getCell(row, 'debit'),
                direction: getCell(row, 'direction'),
                counterpartyName: getCell(row, 'counterpartyName'),
                counterpartyAcc: getCell(row, 'counterpartyAcc'),
                externalRef: getCell(row, 'externalRef'),
                documentCode: getCell(row, 'documentCode'),
                purpose: getCell(row, 'purpose'),
                balance: getCell(row, 'balance'),
            }

            if (this.isEmptyMappedRow(mapped) && normalizeRule.skipEmptyRows !== false) return

            const txnDate = this.parseTxnDate(mapped.date)
            const valueDate = this.parseTxnDate(mapped.valueDate)
            const normalized = this.parseAmountAndDirection(
                mapped.amount,
                mapped.credit,
                mapped.debit,
                mapped.direction,
                normalizeRule,
            )
            const description = this.cleanOptionalText(mapped.description)

            if (!txnDate || !normalized || !description) return

            result.push({
                rowNo: headerRowIndex + offset + 1,
                txnDate,
                valueDate: valueDate ?? undefined,
                direction: normalized.direction,
                amount: normalized.amount,
                description,
                counterpartyName: this.cleanOptionalText(mapped.counterpartyName),
                counterpartyAcc: this.cleanOptionalText(mapped.counterpartyAcc),
                externalRef: this.cleanOptionalText(mapped.externalRef),
                documentCode: this.cleanOptionalText(mapped.documentCode)?.toUpperCase(),
                purposeRaw: this.cleanOptionalText(mapped.purpose),
                raw: mapped,
            })
        })

        return { rows: result }
    }

    private extractHtmlTableRows(html: string): string[][] {
        const rows: string[][] = []
        for (const rowMatch of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
            const cells: string[] = []
            for (const cellMatch of rowMatch[1].matchAll(/<t[dh]\b([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
                const attributes = cellMatch[1]
                const colspan = Math.max(1, Number(/colspan\s*=\s*["']?(\d+)/i.exec(attributes)?.[1] || 1))
                cells.push(this.decodeHtmlCell(cellMatch[2]))
                for (let index = 1; index < colspan; index += 1) cells.push('')
            }
            if (cells.length) rows.push(cells)
        }
        return rows
    }

    private decodeHtmlCell(value: string) {
        return value
            .replace(/<br\s*\/?\s*>/gi, '\n')
            .replace(/<[^>]+>/g, '')
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&quot;/gi, '"')
            .replace(/&#39;|&apos;/gi, "'")
            .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
            .replace(/&#(\d+);/g, (_, decimal) => String.fromCodePoint(Number(decimal)))
            .replace(/\s+/g, ' ')
            .trim()
    }

    private assertRequiredImportColumns(
        columnMap: Record<string, any>,
        columnIndexMap: Record<string, number>,
    ) {
        const requiredKeys = ['date', 'description']
        if (columnMap.amount) {
            requiredKeys.push('amount')
        } else {
            if (columnMap.credit) requiredKeys.push('credit')
            if (columnMap.debit) requiredKeys.push('debit')
        }

        const missingColumns = requiredKeys
            .map((key) => String(columnMap[key] || '').trim())
            .filter((header) => !header || columnIndexMap[header] === undefined)

        if (missingColumns.length) {
            throw new BadRequestException(`BANK_IMPORT_COLUMNS_NOT_FOUND: ${missingColumns.join(', ')}`)
        }
    }

    private extractExcelCellValue(value: ExcelJS.CellValue): any {
        if (value === null || value === undefined) return null

        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value
        }

        if (value instanceof Date) {
            return value
        }

        if (typeof value === 'object') {
            if ('text' in value && value.text != null) return value.text
            if ('result' in value && value.result != null) return value.result
            if ('richText' in value && Array.isArray(value.richText)) {
                return value.richText.map((x: any) => x.text || '').join('')
            }
            if ('formula' in value && 'result' in value && value.result != null) {
                return value.result
            }
            if ('hyperlink' in value && value.text != null) {
                return value.text
            }
        }

        return String(value)
    }

    private toDateOnly(value: string): Date {
        return new Date(`${value}T00:00:00.000Z`)
    }

    private async resolveImportTemplate(bankCode: string, templateId?: string) {
        if (templateId) {
            const template = await this.prisma.bankImportTemplate.findFirst({
                where: {
                    id: templateId,
                    isActive: true,
                },
            })

            if (!template) {
                throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
            }

            return template
        }

        const template = await this.prisma.bankImportTemplate.findFirst({
            where: {
                bankCode,
                isActive: true,
            },
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
        })

        if (!template) {
            throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
        }

        return template
    }

    private async prepareBankRows(bankAccountId: string, rows: ParsedBankRow[]): Promise<PreparedBankRow[]> {
        const activePurposes = await this.prisma.bankTransactionPurpose.findMany({
            where: { isActive: true },
            select: { id: true, code: true, name: true },
        })

        const purposeMap = new Map<string, string>()
        for (const p of activePurposes) {
            purposeMap.set(this.normalizeText(p.code), p.id)
            purposeMap.set(this.normalizeText(p.name), p.id)
        }

        return rows.map((row) => {
            const purposeId = row.purposeRaw ? this.resolvePurposeId(row.purposeRaw, purposeMap) : undefined
            const fingerprint = this.buildTxnFingerprint({
                bankAccountId,
                txnDate: row.txnDate,
                direction: row.direction,
                amount: row.amount,
                description: row.description,
                counterpartyAcc: row.counterpartyAcc,
                externalRef: row.externalRef,
                documentCode: row.documentCode,
            })

            return {
                ...row,
                purposeId,
                fingerprint,
            }
        })
    }

    private async detectDuplicateFlags(bankAccountId: string, rows: PreparedBankRow[]) {
        const externalRefs = rows.map((x) => x.externalRef).filter((x): x is string => !!x)
        const fingerprints = rows.map((x) => x.fingerprint)
        const existingTxns = await this.prisma.bankTransaction.findMany({
            where: {
                bankAccountId,
                OR: [...(externalRefs.length ? [{ externalRef: { in: externalRefs } }] : []), { fingerprint: { in: fingerprints } }],
            },
            select: {
                externalRef: true,
                fingerprint: true,
            },
        })

        const flags = new Set<string>()
        for (const item of existingTxns) {
            flags.add(item.fingerprint)
            if (item.externalRef) flags.add(`ref:${item.externalRef}`)
        }

        return flags
    }

    private isEmptyMappedRow(row: Record<string, any>) {
        return Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '')
    }

    private parseTxnDate(value: any): Date | null {
        if (!value) return null

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(
                value.getFullYear(),
                value.getMonth(),
                value.getDate(),
                value.getHours(),
                value.getMinutes(),
                value.getSeconds(),
            )
        }

        if (typeof value === 'number') {
            const excelEpoch = new Date(1899, 11, 30)
            const d = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000)
            if (!Number.isNaN(d.getTime())) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds())
            }
        }

        const s = String(value).trim()
        if (!s) return null

        // dd/mm/yyyy (BIDV, MB) hoặc dd-mm-yyyy (VietinBank), có thể kèm giờ.
        const slashDate = /^(\d{1,2})([\/\-.])(\d{1,2})\2(\d{2}|\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
        if (slashDate) {
            let day = Number(slashDate[1])
            let month = Number(slashDate[3])
            let year = Number(slashDate[4])
            if (month > 12 && day <= 12) [day, month] = [month, day]
            if (year < 100) year += 2000
            return this.buildValidatedDate(
                year,
                month,
                day,
                Number(slashDate[5] || 0),
                Number(slashDate[6] || 0),
                Number(slashDate[7] || 0),
            )
        }

        const yyyymmdd = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s)
        if (yyyymmdd) {
            return this.buildValidatedDate(
                Number(yyyymmdd[1]),
                Number(yyyymmdd[2]),
                Number(yyyymmdd[3]),
                Number(yyyymmdd[4] || 0),
                Number(yyyymmdd[5] || 0),
                Number(yyyymmdd[6] || 0),
            )
        }

        const d = new Date(s)
        if (!Number.isNaN(d.getTime())) {
            return d
        }

        return null
    }

    private buildValidatedDate(year: number, month: number, day: number, hour = 0, minute = 0, second = 0) {
        const date = new Date(year, month - 1, day, hour, minute, second)
        if (
            date.getFullYear() !== year ||
            date.getMonth() !== month - 1 ||
            date.getDate() !== day ||
            date.getHours() !== hour ||
            date.getMinutes() !== minute ||
            date.getSeconds() !== second
        ) {
            return null
        }
        return date
    }

    private parseAmountAndDirection(
        amountValue: any,
        creditValue: any,
        debitValue: any,
        directionValue: any,
        normalizeRule: Record<string, any>,
    ): { amount: number; direction: BankTxnDirection } | null {
        const parsedAmount = this.parseMoney(amountValue)
        const parsedCredit = this.parseMoney(creditValue)
        const parsedDebit = this.parseMoney(debitValue)

        if (parsedCredit !== null && parsedCredit > 0) {
            return { amount: parsedCredit, direction: BankTxnDirection.IN }
        }

        if (parsedDebit !== null && parsedDebit > 0) {
            return { amount: parsedDebit, direction: BankTxnDirection.OUT }
        }

        if (parsedAmount !== null) {
            if (parsedAmount < 0) {
                return {
                    amount: Math.abs(parsedAmount),
                    direction: BankTxnDirection.OUT,
                }
            }

            const direction = this.parseDirection(directionValue, normalizeRule)
            if (direction) {
                return { amount: Math.abs(parsedAmount), direction }
            }

            return { amount: Math.abs(parsedAmount), direction: BankTxnDirection.IN }
        }

        return null
    }

    private parseDirection(value: any, normalizeRule: Record<string, any>): BankTxnDirection | null {
        if (!value) return null

        const text = this.normalizeText(value)
        const inValues = (normalizeRule.inValues || ['thu', 'credit', 'in']).map((x: any) => this.normalizeText(x))
        const outValues = (normalizeRule.outValues || ['chi', 'debit', 'out']).map((x: any) => this.normalizeText(x))

        if (inValues.includes(text)) return BankTxnDirection.IN
        if (outValues.includes(text)) return BankTxnDirection.OUT

        return null
    }

    private parseMoney(value: any): number | null {
        if (value === null || value === undefined || value === '') return null

        if (typeof value === 'number') return Number(value)

        let s = String(value).trim()
        if (!s) return null

        const negativeByParentheses = /^\(.*\)$/.test(s)
        s = s
            .replace(/^'+/, '')
            .replace(/[()]/g, '')
            .replace(/\s+/g, '')
            .replace(/₫|VND/gi, '')
            .replace(/[^0-9,+.\-]/g, '')

        const commaCount = (s.match(/,/g) || []).length
        const dotCount = (s.match(/\./g) || []).length
        const lastComma = s.lastIndexOf(',')
        const lastDot = s.lastIndexOf('.')

        if (commaCount && dotCount) {
            const decimalSeparator = lastComma > lastDot ? ',' : '.'
            const thousandsSeparator = decimalSeparator === ',' ? '.' : ','
            s = s.replace(new RegExp(`\\${thousandsSeparator}`, 'g'), '')
            if (decimalSeparator === ',') s = s.replace(',', '.')
        } else if (commaCount) {
            const digitsAfter = s.length - lastComma - 1
            s = commaCount > 1 || digitsAfter === 3 ? s.replace(/,/g, '') : s.replace(',', '.')
        } else if (dotCount) {
            const digitsAfter = s.length - lastDot - 1
            if (dotCount > 1 || digitsAfter === 3) s = s.replace(/\./g, '')
        }

        const n = Number(s) * (negativeByParentheses ? -1 : 1)
        return Number.isFinite(n) ? n : null
    }

    private cleanOptionalText(value: any): string | undefined {
        const s = String(value ?? '')
            .replace(/\s+/g, ' ')
            .trim()
        return s || undefined
    }

    private normalizeText(input?: string | null): string {
        return String(input ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase()
    }

    /**
     * Số tài khoản trên sao kê hay kèm khoảng trắng, dấu chấm hoặc gạch ngang tùy ngân
     * hàng, nên chỉ giữ lại chữ và số trước khi so sánh.
     */
    private normalizeAccountNo(input?: string | null): string {
        return String(input ?? '')
            .replace(/[^0-9a-zA-Z]/g, '')
            .toLowerCase()
    }

    private sha256(buffer: Buffer): string {
        return crypto.createHash('sha256').update(buffer).digest('hex')
    }

    private buildTxnFingerprint(input: {
        bankAccountId: string
        txnDate: Date
        direction: BankTxnDirection
        amount: number
        description: string
        counterpartyAcc?: string
        externalRef?: string
        documentCode?: string
    }) {
        const payload = [
            input.bankAccountId,
            input.txnDate.toISOString().slice(0, 10),
            input.direction,
            input.amount.toFixed(2),
            this.normalizeText(input.description),
            (input.counterpartyAcc || '').replace(/\s+/g, ''),
            input.externalRef || '',
            input.documentCode || '',
        ].join('|')

        return crypto.createHash('sha256').update(payload).digest('hex')
    }

    private resolvePurposeId(raw: string, purposeMap: Map<string, string>): string | undefined {
        const normalized = this.normalizeText(raw)
        if (!normalized) return undefined

        if (purposeMap.has(normalized)) {
            return purposeMap.get(normalized)
        }

        for (const [key, value] of purposeMap.entries()) {
            if (normalized.includes(key) || key.includes(normalized)) {
                return value
            }
        }

        return undefined
    }

    private computeSuggestedAllocatedAmount(txnRemainingAmount: number, settlementRemainingAmount: number) {
        return Math.min(Number(txnRemainingAmount || 0), Number(settlementRemainingAmount || 0))
    }

    private computeSettlementMatchScore(input: {
        txnAmount: number
        txnRemainingAmount: number
        txnDate?: Date
        txnDescription?: string
        txnCounterpartyName?: string
        txnCounterpartyAcc?: string | null
        settlementRemainingAmount: number
        supplierName?: string | null
        /** Số tài khoản đã khai của nhà cung cấp, để đối chiếu với người chuyển/nhận tiền. */
        supplierBankAccounts?: string[]
        invoices: Array<{
            invoiceNo?: string | null
            invoiceSymbol?: string | null
            invoiceDate?: Date | null
        }>
    }) {
        let score = 0

        const txnAmount = Number(input.txnAmount || 0)
        const txnRemainingAmount = Number(input.txnRemainingAmount || 0)
        const settlementRemainingAmount = Number(input.settlementRemainingAmount || 0)

        // =========================
        // 1. Amount match (ưu tiên cao nhất)
        // =========================
        const diff = Math.abs(txnRemainingAmount - settlementRemainingAmount)

        if (diff === 0) {
            score += 60
        } else if (diff <= 1000) {
            score += 55
        } else if (txnRemainingAmount > 0) {
            const ratio = diff / txnRemainingAmount
            if (ratio <= 0.01) score += 45
            else if (ratio <= 0.03) score += 30
            else if (ratio <= 0.05) score += 15
        }

        // Match theo tổng transaction nếu transaction đã có phân bổ một phần
        if (txnAmount > 0 && txnAmount !== txnRemainingAmount) {
            const diffByTotal = Math.abs(txnAmount - settlementRemainingAmount)
            if (diffByTotal === 0) score += 8
            else if (diffByTotal <= 1000) score += 6
        }

        // =========================
        // 2. Supplier / counterparty name
        // =========================
        const supplierName = this.normalizeCompanyName(input.supplierName)
        const counterpartyName = this.normalizeCompanyName(input.txnCounterpartyName)

        if (supplierName && counterpartyName) {
            if (counterpartyName === supplierName) {
                score += 18
            } else if (counterpartyName.includes(supplierName) || supplierName.includes(counterpartyName)) {
                score += 12
            }
        }

        // Số tài khoản đối tác là bằng chứng chắc chắn hơn tên rất nhiều: tên trên sao kê
        // hay bị viết tắt, bỏ dấu hay thêm bớt "CTY TNHH", còn số tài khoản thì trùng là
        // trùng. Cùng thang điểm với phía phải thu (receivables.service).
        const counterpartyAcc = this.normalizeAccountNo(input.txnCounterpartyAcc)
        if (
            counterpartyAcc &&
            (input.supplierBankAccounts ?? []).some(
                (accountNo) => this.normalizeAccountNo(accountNo) === counterpartyAcc,
            )
        ) {
            score += 75
        }

        // =========================
        // 3. Invoice number / symbol in description
        // =========================
        const desc = input.txnDescription || ''
        for (const inv of input.invoices) {
            const invoiceNo = this.normalizeText(inv.invoiceNo)
            const invoiceSymbol = this.normalizeText(inv.invoiceSymbol)

            if (invoiceNo && desc.includes(invoiceNo)) score += 20
            if (invoiceSymbol && desc.includes(invoiceSymbol)) score += 10
        }

        // =========================
        // 4. Time proximity
        // =========================
        if (input.txnDate) {
            let bestDaysDiff: number | null = null

            for (const inv of input.invoices) {
                if (!inv.invoiceDate) continue

                const invDate = new Date(inv.invoiceDate)
                const days = Math.abs((input.txnDate.getTime() - invDate.getTime()) / (1000 * 60 * 60 * 24))

                if (bestDaysDiff === null || days < bestDaysDiff) {
                    bestDaysDiff = days
                }
            }

            if (bestDaysDiff !== null) {
                if (bestDaysDiff <= 3) score += 10
                else if (bestDaysDiff <= 7) score += 6
                else if (bestDaysDiff <= 15) score += 3
            }
        }

        // =========================
        // 5. Weak fallback when no description
        // =========================
        if (!desc && supplierName) {
            score += 3
        }

        return Math.min(score, 100)
    }

    private normalizeCompanyName(input?: string | null): string {
        const s = this.normalizeText(input)
        if (!s) return ''

        return s
            .replace(/\bcong ty\b/g, '')
            .replace(/\bco\b/g, '')
            .replace(/\bltd\b/g, '')
            .replace(/\btrach nhiem huu han\b/g, '')
            .replace(/\btnhh\b/g, '')
            .replace(/\bmot thanh vien\b/g, '')
            .replace(/\bmtv\b/g, '')
            .replace(/\bco phan\b/g, '')
            .replace(/\bcp\b/g, '')
            .replace(/&/g, ' ')
            .replace(/[.,\-_/]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    }
}
