import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { BankImportStatus, BankTxnDirection, BankTxnMatchStatus, Prisma, SettlementStatus } from '@prisma/client'
import * as ExcelJS from 'exceljs'
import * as crypto from 'crypto'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { CreateBankImportDto } from './dto/create-bank-import.dto'
import { BankImportTemplatesService } from '../bank-import-templates/bank-import-templates.service'
import { DeleteMultipleBankTransactionsDto } from './dto/delete-multiple-bank-transactions.dto'

type ParsedBankRow = {
    txnDate: Date
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

@Injectable()
export class BankingService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly bankImportTemplatesService: BankImportTemplatesService,
    ) {}

    async listTransactions(query: QueryBankTransactionsDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 20
        const skip = (page - 1) * pageSize

        const where: Prisma.BankTransactionWhereInput = {
            ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
            ...(query.direction ? { direction: query.direction as BankTxnDirection } : {}),
            ...(query.matchStatus ? { matchStatus: query.matchStatus as BankTxnMatchStatus } : {}),
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
                    allocations: {
                        include: {
                            settlement: {
                                include: {
                                    invoices: {
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
                        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                    },
                },
            }),
            this.prisma.bankTransaction.count({ where }),
        ])

        const data = items.map((item) => {
            const allocatedAmount = item.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0)
            const remainingAmount = Number(item.amount) - allocatedAmount
            const canDelete = item.matchStatus === BankTxnMatchStatus.UNMATCHED && item.isConfirmed !== true && item.allocations.length === 0

            return {
                ...item,
                amount: Number(item.amount),
                allocatedAmount,
                remainingAmount,
                purposeName: item.purpose?.name ?? null,
                canDelete,
            }
        })

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
                allocations: {
                    select: { id: true },
                    take: 1,
                },
            },
        })

        if (!item) {
            throw new NotFoundException('Không tìm thấy giao dịch ngân hàng')
        }

        if (item.matchStatus !== BankTxnMatchStatus.UNMATCHED || item.isConfirmed || item.allocations.length > 0) {
            throw new BadRequestException('Chỉ được xóa giao dịch chưa khớp và chưa xác nhận')
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
                matchStatus: true,
                isConfirmed: true,
                allocations: {
                    select: { id: true },
                    take: 1,
                },
            },
        })

        if (items.length !== dto.ids.length) {
            throw new NotFoundException('Một hoặc nhiều giao dịch không tồn tại')
        }

        const invalid = items.filter((x) => x.matchStatus !== BankTxnMatchStatus.UNMATCHED || x.isConfirmed || x.allocations.length > 0)

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
                allocations: {
                    include: {
                        settlement: {
                            include: {
                                invoices: true,
                                supplier: {
                                    select: { id: true, code: true, name: true },
                                },
                            },
                        },
                    },
                    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                },
            },
        })

        if (!txn) {
            throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        }

        const allocatedAmount = txn.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0)
        const remainingAmount = Number(txn.amount) - allocatedAmount
        const canDelete = txn.matchStatus === BankTxnMatchStatus.UNMATCHED && txn.isConfirmed !== true && txn.allocations.length === 0

        return {
            ...txn,
            amount: Number(txn.amount),
            allocatedAmount,
            remainingAmount,
            purposeName: txn.purpose?.name ?? null,
            canDelete,
        }
    }

    async getMatchSuggestions(id: string) {
        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: {
                allocations: true,
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

        const allocatedAmount = txn.allocations.reduce((sum, a) => sum + Number(a.allocatedAmount), 0)
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
                const settlements = await this.prisma.supplierSettlement.findMany({
                    where: {
                        status: {
                            in: [SettlementStatus.OPEN, SettlementStatus.PARTIAL],
                        },
                        invoices: {
                            some: {
                                purchaseOrderId: purchaseOrder.id,
                            },
                        },
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
                        invoices: {
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
                            const settlementRemaining = Number(s.amountTotal) - Number(s.amountSettled)
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
                                invoices: s.invoices.map((inv) => ({
                                    ...inv,
                                    totalAmount: inv.totalAmount ? Number(inv.totalAmount) : 0,
                                })),
                                amountTotal: Number(s.amountTotal),
                                amountSettled: Number(s.amountSettled),
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
        const settlements = await this.prisma.supplierSettlement.findMany({
            where: {
                status: {
                    in: [SettlementStatus.OPEN, SettlementStatus.PARTIAL],
                },
                ...(txn.direction === BankTxnDirection.OUT ? {} : { type: 'ADVANCE' }),
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
                invoices: {
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
                const remainingSettlement = Number(s.amountTotal) - Number(s.amountSettled)

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
                    invoices: s.invoices.map((inv) => ({
                        invoiceNo: inv.invoiceNo,
                        invoiceSymbol: inv.invoiceSymbol,
                        invoiceDate: inv.invoiceDate,
                    })),
                })

                return {
                    settlementId: s.id,
                    supplier: s.supplier,
                    invoices: s.invoices.map((inv) => ({
                        ...inv,
                        totalAmount: inv.totalAmount ? Number(inv.totalAmount) : 0,
                    })),
                    amountTotal: Number(s.amountTotal),
                    amountSettled: Number(s.amountSettled),
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
        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id },
            include: { allocations: true },
        })

        if (!txn) throw new NotFoundException('BANK_TRANSACTION_NOT_FOUND')
        if (txn.isConfirmed) throw new BadRequestException('BANK_TRANSACTION_ALREADY_CONFIRMED')
        if (txn.direction !== BankTxnDirection.OUT) throw new BadRequestException('ONLY_OUT_TRANSACTION_SUPPORTED')

        const totalAllocated = body.allocations.reduce((sum, item) => sum + Number(item.allocatedAmount), 0)

        if (totalAllocated <= 0) throw new BadRequestException('TOTAL_ALLOCATED_MUST_BE_GT_ZERO')

        if (totalAllocated - Number(txn.amount) > 0.0001) throw new BadRequestException('ALLOCATED_EXCEEDS_TRANSACTION_AMOUNT')

        const seen = new Set<string>()
        for (const item of body.allocations) {
            if (seen.has(item.settlementId)) {
                throw new BadRequestException('DUPLICATE_SETTLEMENT_ALLOCATION')
            }
            seen.add(item.settlementId)
        }

        return this.prisma.$transaction(async (trx) => {
            for (const item of body.allocations) {
                const settlement = await trx.supplierSettlement.findUnique({
                    where: { id: item.settlementId },
                })

                if (!settlement) throw new BadRequestException('SETTLEMENT_NOT_FOUND')

                const remaining = Number(settlement.amountTotal) - Number(settlement.amountSettled)

                if (item.allocatedAmount - remaining > 0.0001) {
                    throw new BadRequestException(`ALLOCATED_EXCEEDS_SETTLEMENT_REMAINING:${settlement.id}`)
                }

                if (settlement.status !== SettlementStatus.OPEN && settlement.status !== SettlementStatus.PARTIAL) {
                    throw new BadRequestException(`INVALID_SETTLEMENT_STATUS:${settlement.id}`)
                }

                const updated = await trx.supplierSettlement.update({
                    where: { id: item.settlementId },
                    data: {
                        amountSettled: {
                            increment: new Prisma.Decimal(item.allocatedAmount),
                        },
                    },
                })

                const nextSettled = Number(updated.amountSettled)
                const total = Number(updated.amountTotal)

                let nextStatus: SettlementStatus = SettlementStatus.OPEN

                if (nextSettled + 0.0001 >= total) {
                    nextStatus = SettlementStatus.SETTLED
                } else if (nextSettled > 0) {
                    nextStatus = SettlementStatus.PARTIAL
                }

                await trx.supplierSettlement.update({
                    where: { id: item.settlementId },
                    data: { status: nextStatus },
                })

                await trx.paymentAllocation.create({
                    data: {
                        bankTransactionId: txn.id,
                        settlementId: item.settlementId,
                        allocatedAmount: new Prisma.Decimal(item.allocatedAmount),
                        isAuto: item.isAuto ?? false,
                        score: item.score ?? null,
                        sortOrder: item.sortOrder ?? 0,
                        note: item.note ?? body.note ?? null,
                    },
                })
            }

            await trx.bankTransaction.update({
                where: { id: txn.id },
                data: {
                    matchStatus: totalAllocated + 0.0001 >= Number(txn.amount) ? BankTxnMatchStatus.MANUAL_MATCHED : BankTxnMatchStatus.PARTIAL_MATCHED,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                },
            })

            return this.getTransactionDetail(id)
        })
    }

    async listTemplates(bankCode?: string) {
        return this.bankImportTemplatesService.listActive(bankCode)
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

    async importStatement(file: Express.Multer.File, body: CreateBankImportDto) {
        if (!file) {
            throw new BadRequestException('FILE_REQUIRED')
        }

        if (!file.originalname.toLowerCase().endsWith('.xlsx')) {
            throw new BadRequestException('ONLY_XLSX_SUPPORTED_IN_PHASE_1')
        }

        const bankAccount = await this.prisma.bankAccount.findUnique({
            where: { id: body.bankAccountId },
        })

        if (!bankAccount) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        const template = body.templateId
            ? await this.prisma.bankImportTemplate.findUnique({
                  where: { id: body.templateId },
              })
            : null

        if (body.templateId && !template) {
            throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
        }

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
                templateId: body.templateId ?? null,
                status: BankImportStatus.PROCESSING,
                fileUrl: file.originalname,
                fileChecksum: checksum,
                startedAt: new Date(),
                createdBy: null,
            },
        })

        try {
            const parsed = await this.parseXlsxWithExcelJS(file.buffer, template?.columnMap, template?.normalizeRule)

            if (!parsed.rows.length) {
                throw new BadRequestException('BANK_IMPORT_NO_VALID_ROWS')
            }

            const activePurposes = await this.prisma.bankTransactionPurpose.findMany({
                where: { isActive: true },
                select: { id: true, code: true, name: true },
            })

            const purposeMap = new Map<string, string>()
            for (const p of activePurposes) {
                purposeMap.set(this.normalizeText(p.code), p.id)
                purposeMap.set(this.normalizeText(p.name), p.id)
            }

            const prepared = parsed.rows.map((row) => {
                const purposeId = row.purposeRaw ? this.resolvePurposeId(row.purposeRaw, purposeMap) : undefined

                const fingerprint = this.buildTxnFingerprint({
                    bankAccountId: body.bankAccountId,
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
                        direction: row.direction,
                        amount: new Prisma.Decimal(row.amount),
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
            }

            if (this.isEmptyMappedRow(mapped)) {
                if (normalizeRule.skipEmptyRows !== false) return
            }

            const txnDate = this.parseTxnDate(mapped.date)
            const normalized = this.parseAmountAndDirection(mapped.amount, mapped.credit, mapped.debit, mapped.direction, normalizeRule)
            const description = this.cleanOptionalText(mapped.description)

            if (!txnDate || !normalized || !description) {
                return
            }

            const documentCode = this.cleanOptionalText(mapped.documentCode)?.toUpperCase()
            const purposeRaw = this.cleanOptionalText(mapped.purpose)

            result.push({
                txnDate,
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

    private isEmptyMappedRow(row: Record<string, any>) {
        return Object.values(row).every((v) => v === null || v === undefined || String(v).trim() === '')
    }

    private parseTxnDate(value: any): Date | null {
        if (!value) return null

        if (value instanceof Date && !Number.isNaN(value.getTime())) {
            return new Date(value.getFullYear(), value.getMonth(), value.getDate())
        }

        if (typeof value === 'number') {
            const excelEpoch = new Date(1899, 11, 30)
            const d = new Date(excelEpoch.getTime() + value * 24 * 60 * 60 * 1000)
            if (!Number.isNaN(d.getTime())) {
                return new Date(d.getFullYear(), d.getMonth(), d.getDate())
            }
        }

        const s = String(value).trim()
        if (!s) return null

        const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
        if (ddmmyyyy) {
            const [, dd, mm, yyyy] = ddmmyyyy
            return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
        }

        const yyyymmdd = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
        if (yyyymmdd) {
            const [, yyyy, mm, dd] = yyyymmdd
            return new Date(Number(yyyy), Number(mm) - 1, Number(dd))
        }

        const d = new Date(s)
        if (!Number.isNaN(d.getTime())) {
            return new Date(d.getFullYear(), d.getMonth(), d.getDate())
        }

        return null
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

        s = s.replace(/\s+/g, '')
        s = s.replace(/₫|VND|vnd/gi, '')

        if (s.includes('.') && s.includes(',')) {
            s = s.replace(/\./g, '').replace(/,/g, '.')
        } else if (s.includes(',')) {
            s = s.replace(/,/g, '.')
        } else {
            const dotCount = (s.match(/\./g) || []).length
            if (dotCount > 1) {
                s = s.replace(/\./g, '')
            }
        }

        const n = Number(s)
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
