import { BadRequestException, Injectable } from '@nestjs/common'
import { BankImportStatus, BankTxnDirection } from '@prisma/client'
import { Prisma } from '@prisma/client'
import ExcelJS from 'exceljs'
import * as crypto from 'crypto'
import type { NormalizedBankTxn } from './bank-import.types'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class BankImportProcessor {
    constructor(private readonly prisma: PrismaService) {}

    async processImport(importId: string) {
        const imp = await this.prisma.bankStatementImport.findUnique({
            where: { id: importId },
            include: { template: true, bankAccount: true },
        })
        if (!imp) throw new BadRequestException('IMPORT_NOT_FOUND')

        await this.prisma.bankStatementImport.update({
            where: { id: imp.id },
            data: { status: BankImportStatus.PROCESSING, startedAt: new Date() },
        })

        let imported = 0
        let duplicated = 0
        let failed = 0

        try {
            const workbook = new ExcelJS.Workbook()
            await workbook.xlsx.readFile(imp.fileUrl)
            const ws = workbook.worksheets[0]
            if (!ws) throw new Error('SHEET_NOT_FOUND')

            const headerRow = ws.getRow(1)
            const headerMap = buildHeaderMap(headerRow)
            const columnMap = (imp.template?.columnMap as any) ?? undefined

            const lastRow = ws.rowCount

            for (let r = 2; r <= lastRow; r++) {
                const row = ws.getRow(r)
                if (isRowEmpty(row)) continue

                try {
                    const n = normalizeRowExcelJs(row, headerMap, columnMap)

                    const fingerprint = crypto
                        .createHash('sha256')
                        .update(`${imp.bankAccountId}|${n.txnDate.toISOString()}|${n.direction}|${n.amount.toFixed(2)}|${n.description}`)
                        .digest('hex')

                    await this.prisma.bankTransaction.create({
                        data: {
                            bankAccountId: imp.bankAccountId,
                            importId: imp.id,
                            txnDate: n.txnDate,
                            direction: n.direction,
                            amount: new Prisma.Decimal(n.amount),
                            description: n.description,
                            counterpartyName: n.counterpartyName,
                            counterpartyAcc: n.counterpartyAcc,
                            externalRef: n.externalRef,
                            fingerprint,
                            raw: n.raw,
                        },
                    })

                    imported++
                } catch (e: any) {
                    if (e?.code === 'P2002') duplicated++
                    else failed++
                }
            }

            await this.prisma.bankStatementImport.update({
                where: { id: imp.id },
                data: {
                    status: BankImportStatus.DONE,
                    importedCount: imported,
                    duplicatedCount: duplicated,
                    failedCount: failed,
                    finishedAt: new Date(),
                },
            })

            return { importId: imp.id, imported, duplicated, failed }
        } catch (err: any) {
            await this.prisma.bankStatementImport.update({
                where: { id: imp.id },
                data: {
                    status: BankImportStatus.FAILED,
                    errorMessage: err.message,
                    finishedAt: new Date(),
                },
            })
            throw err
        }
    }
}

/** ============ Helpers ============ */

function buildHeaderMap(headerRow: ExcelJS.Row) {
    const map = new Map<string, number>()
    headerRow.eachCell((cell, colNumber) => {
        const v = String(cell.value ?? '').trim()
        if (v) map.set(normalizeHeader(v), colNumber)
    })
    return map
}

function normalizeHeader(s: string) {
    return s.trim().toLowerCase()
}

function isRowEmpty(row: ExcelJS.Row) {
    let has = false
    row.eachCell((cell) => {
        const v = cell.value
        if (v !== null && v !== undefined && String(v).trim() !== '') has = true
    })
    return !has
}

function getCellByHeader(row: ExcelJS.Row, headerMap: Map<string, number>, headerName: string) {
    const idx = headerMap.get(normalizeHeader(headerName))
    if (!idx) return undefined
    return row.getCell(idx).value
}

function pick(row: ExcelJS.Row, headerMap: Map<string, number>, columnMap: any | undefined, key: string, fallbackHeader: string) {
    const headerName = columnMap?.[key] ?? fallbackHeader
    return getCellByHeader(row, headerMap, headerName)
}

/**
 * Mặc định theo format bạn hay dùng:
 * - Ngày giao dịch
 * - Nội dung
 * - Thu / Chi (2 cột riêng, số dương)
 * - Đối tác, STK NCC
 * - externalRef: nếu file không có thì null
 *
 * Nếu tên cột khác → dùng BankImportTemplate.columnMap để map.
 */
function normalizeRowExcelJs(row: ExcelJS.Row, headerMap: Map<string, number>, columnMap?: any): NormalizedBankTxn {
    const rawTxnDate = pick(row, headerMap, columnMap, 'txnDate', 'Ngày giao dịch')
    const rawDesc = pick(row, headerMap, columnMap, 'description', 'Nội dung')
    const rawIn = pick(row, headerMap, columnMap, 'inAmount', 'Thu')
    const rawOut = pick(row, headerMap, columnMap, 'outAmount', 'Chi')
    const rawCpName = pick(row, headerMap, columnMap, 'counterpartyName', 'Đối tác')
    const rawCpAcc = pick(row, headerMap, columnMap, 'counterpartyAcc', 'STK NCC')
    const rawExternalRef = pick(row, headerMap, columnMap, 'externalRef', 'Số tham chiếu')

    const txnDate = parseExcelDate(rawTxnDate)
    if (!txnDate) throw new Error('INVALID_TXN_DATE')

    const inAmt = parseMoney(rawIn)
    const outAmt = parseMoney(rawOut)

    let direction: BankTxnDirection
    let amount: number

    if (inAmt > 0 && outAmt > 0) throw new Error('INVALID_BOTH_IN_OUT')

    if (inAmt > 0) {
        direction = BankTxnDirection.IN
        amount = inAmt
    } else if (outAmt > 0) {
        direction = BankTxnDirection.OUT
        amount = outAmt
    } else {
        // fallback nếu file dùng 1 cột "Số tiền" +/- (tuỳ template)
        const rawAmount = pick(row, headerMap, columnMap, 'amount', 'Số tiền')
        const a = parseMoney(rawAmount, true)
        direction = a >= 0 ? BankTxnDirection.IN : BankTxnDirection.OUT
        amount = Math.abs(a)
    }

    const description = String((rawDesc as any)?.text ?? rawDesc ?? '').trim()
    const counterpartyName = String((rawCpName as any)?.text ?? rawCpName ?? '').trim() || null
    const counterpartyAcc = String((rawCpAcc as any)?.text ?? rawCpAcc ?? '').trim() || null
    const externalRef = rawExternalRef ? String((rawExternalRef as any)?.text ?? rawExternalRef).trim() : null

    return {
        txnDate,
        direction,
        amount,
        description,
        counterpartyName,
        counterpartyAcc,
        externalRef,
        raw: {
            txnDate: txnDate.toISOString(),
            inAmount: inAmt,
            outAmount: outAmt,
            description,
            counterpartyName,
            counterpartyAcc,
            externalRef,
        },
    }
}

function parseMoney(v: any, allowNegative = false) {
    if (v === null || v === undefined || v === '') return 0
    if (typeof v === 'number') return allowNegative ? v : Math.abs(v)

    const s = String((v as any)?.text ?? v).trim()
    if (!s) return 0

    const cleaned = s.replace(/\s/g, '').replace(/[₫,]/g, '').replace(/\./g, '') // 1.234.567
    const n = Number(cleaned)
    if (Number.isNaN(n)) return 0
    return allowNegative ? n : Math.abs(n)
}

function parseExcelDate(v: any): Date | null {
    if (!v) return null
    if (v instanceof Date) return v

    // Excel serial date number
    if (typeof v === 'number') {
        const utcDays = Math.floor(v - 25569)
        const utcValue = utcDays * 86400
        return new Date(utcValue * 1000)
    }

    const s = String((v as any)?.text ?? v).trim()
    if (!s) return null

    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
    if (m) {
        const dd = Number(m[1])
        const mm = Number(m[2])
        const yyyy = Number(m[3])
        return new Date(yyyy, mm - 1, dd)
    }

    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
}
