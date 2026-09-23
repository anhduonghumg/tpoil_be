import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ReceivableSettlementType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ReceivableInterestReportQueryDto, UpsertDepositInterestRateDto } from './dto/receivable-interest.dto'

const DAYS_PER_YEAR = 365

/** Ngày lịch theo giờ địa phương (tiến trình đã cố định múi giờ VN — xem common/timezone.ts). */
function dayKeyOf(value: Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

/** Cột DATE: Prisma trả về đúng nửa đêm UTC, nên lấy ngày UTC mới ra đúng ngày đã lưu. */
function dateColumnKey(value: Date) {
    return value.toISOString().slice(0, 10)
}

/**
 * Báo cáo "lãi bị mất do khách nợ": nếu số tiền khách đang nợ được gửi ngân hàng thì công
 * ty đã nhận được bao nhiêu lãi.
 *
 * Tính đúng như ngân hàng tính lãi tiền gửi: mỗi ngày, số dư cuối ngày × lãi suất năm có
 * hiệu lực ngày đó ÷ 365, rồi cộng dồn. Khách trả dần thì số dư giảm dần, nên không lấy số
 * nợ ban đầu nhân cả kỳ. Tính theo từng khoản nợ để tách được phần phát sinh SAU hạn thanh
 * toán — phần đó là tiền mất vì khách trễ hạn, khác với phần mình chủ động cho nợ trong hạn.
 *
 * Đây là số quản trị (chi phí cơ hội), không ghi sổ kế toán.
 */
@Injectable()
export class ReceivableInterestService {
    constructor(private readonly prisma: PrismaService) {}

    // ---------------------------------------------------------------- lãi suất tham chiếu

    listRates() {
        return this.prisma.depositInterestRate.findMany({ orderBy: { effectiveFrom: 'desc' } })
    }

    async createRate(dto: UpsertDepositInterestRateDto, actorId: string | null) {
        try {
            return await this.prisma.depositInterestRate.create({
                data: {
                    effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00.000Z`),
                    annualRate: new Prisma.Decimal(dto.annualRate),
                    note: dto.note?.trim() || null,
                    createdById: actorId,
                },
            })
        } catch (error) {
            throw this.duplicateDate(error, dto.effectiveFrom)
        }
    }

    async updateRate(id: string, dto: UpsertDepositInterestRateDto) {
        await this.findRate(id)
        try {
            return await this.prisma.depositInterestRate.update({
                where: { id },
                data: {
                    effectiveFrom: new Date(`${dto.effectiveFrom}T00:00:00.000Z`),
                    annualRate: new Prisma.Decimal(dto.annualRate),
                    note: dto.note?.trim() || null,
                },
            })
        } catch (error) {
            throw this.duplicateDate(error, dto.effectiveFrom)
        }
    }

    async deleteRate(id: string) {
        await this.findRate(id)
        await this.prisma.depositInterestRate.delete({ where: { id } })
        return { id }
    }

    private async findRate(id: string) {
        const rate = await this.prisma.depositInterestRate.findUnique({ where: { id } })
        if (!rate) throw new NotFoundException({ code: 'DEPOSIT_INTEREST_RATE_NOT_FOUND', message: 'Không tìm thấy mức lãi suất.' })
        return rate
    }

    private duplicateDate(error: unknown, date: string) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            return new ConflictException({
                code: 'DEPOSIT_INTEREST_RATE_DATE_EXISTS',
                message: `Đã có mức lãi suất hiệu lực từ ngày ${date.split('-').reverse().join('/')}.`,
            })
        }
        return error
    }

    // ---------------------------------------------------------------- báo cáo

    async report(query: ReceivableInterestReportQueryDto) {
        const today = new Date()
        const defaultFrom = new Date(today.getFullYear(), today.getMonth(), 1)
        const from = query.fromDate ? new Date(`${query.fromDate}T00:00:00`) : defaultFrom
        const requestedTo = query.toDate ? new Date(`${query.toDate}T23:59:59.999`) : today
        if (Number.isNaN(from.getTime()) || Number.isNaN(requestedTo.getTime()) || from > requestedTo) {
            throw new BadRequestException({ code: 'REPORT_PERIOD_INVALID', message: 'Khoảng thời gian báo cáo không hợp lệ.' })
        }
        // Không tính sang những ngày chưa tới: số dư tương lai chưa ai biết.
        const endOfToday = new Date(today)
        endOfToday.setHours(23, 59, 59, 999)
        const to = requestedTo > endOfToday ? endOfToday : requestedTo

        const [rates, items] = await Promise.all([
            this.prisma.depositInterestRate.findMany({ orderBy: { effectiveFrom: 'asc' } }),
            this.prisma.receivableOpenItem.findMany({
                where: {
                    settlementType: ReceivableSettlementType.RECEIVABLE,
                    customerPartyId: query.customerPartyId ?? undefined,
                    entries: { some: { effectiveAt: { lte: to } } },
                },
                select: {
                    id: true,
                    dueDate: true,
                    note: true,
                    legacyReference: true,
                    installmentNo: true,
                    customer: { select: { id: true, code: true, name: true } },
                    salesInvoice: { select: { invoiceNoInternal: true, misaInvoiceNo: true } },
                    salesOrder: { select: { orderNo: true } },
                    withdrawalRequest: { select: { requestNo: true } },
                    entries: {
                        where: { effectiveAt: { lte: to } },
                        select: { effectiveAt: true, amountDelta: true },
                        orderBy: { effectiveAt: 'asc' },
                    },
                },
            }),
        ])

        const rateTable = rates.map((rate) => ({ key: dateColumnKey(rate.effectiveFrom), rate: new Prisma.Decimal(rate.annualRate) }))
        const rateOn = (dayKey: string) => {
            let applicable: Prisma.Decimal | null = null
            for (const row of rateTable) {
                if (row.key > dayKey) break
                applicable = row.rate
            }
            return applicable
        }

        const periodDays: string[] = []
        for (const day = new Date(from); day <= to; day.setDate(day.getDate() + 1)) periodDays.push(dayKeyOf(day))

        const missingRateDays = new Set<string>()
        const customers = new Map<string, any>()

        for (const item of items) {
            let balance = new Prisma.Decimal(0)
            const changes = new Map<string, Prisma.Decimal>()
            let issuedKey: string | null = null
            for (const entry of item.entries) {
                const amount = new Prisma.Decimal(entry.amountDelta)
                const key = dayKeyOf(entry.effectiveAt)
                if (!issuedKey && amount.greaterThan(0)) issuedKey = key
                if (entry.effectiveAt < from) balance = balance.plus(amount)
                else changes.set(key, (changes.get(key) ?? new Prisma.Decimal(0)).plus(amount))
            }
            if (!balance.greaterThan(0) && !changes.size) continue

            const dueKey = item.dueDate ? dateColumnKey(item.dueDate) : null
            let debtDays = new Prisma.Decimal(0)
            let lostInterest = new Prisma.Decimal(0)
            let overdueLostInterest = new Prisma.Decimal(0)
            let daysOutstanding = 0
            let overdueDays = 0

            for (const dayKey of periodDays) {
                const change = changes.get(dayKey)
                if (change) balance = balance.plus(change)
                if (!balance.greaterThan(0)) continue

                daysOutstanding += 1
                debtDays = debtDays.plus(balance)
                // Hạn thanh toán là DATE: đúng ngày đến hạn thì chưa quá hạn.
                const overdue = dueKey != null && dayKey > dueKey
                if (overdue) overdueDays += 1

                const rate = rateOn(dayKey)
                if (rate == null) {
                    missingRateDays.add(dayKey)
                    continue
                }
                const interest = balance.mul(rate).div(100).div(DAYS_PER_YEAR)
                lostInterest = lostInterest.plus(interest)
                if (overdue) overdueLostInterest = overdueLostInterest.plus(interest)
            }
            if (!daysOutstanding) continue

            const customer = customers.get(item.customer.id) ?? {
                customer: item.customer,
                debtDays: new Prisma.Decimal(0),
                lostInterest: new Prisma.Decimal(0),
                overdueLostInterest: new Prisma.Decimal(0),
                closingDebt: new Prisma.Decimal(0),
                items: [] as any[],
            }
            customer.debtDays = customer.debtDays.plus(debtDays)
            customer.lostInterest = customer.lostInterest.plus(lostInterest)
            customer.overdueLostInterest = customer.overdueLostInterest.plus(overdueLostInterest)
            customer.closingDebt = customer.closingDebt.plus(Prisma.Decimal.max(balance, 0))
            customer.items.push({
                id: item.id,
                documentNo: this.documentNoOf(item),
                issuedDate: issuedKey,
                dueDate: dueKey,
                daysOutstanding,
                overdueDays,
                averageBalance: debtDays.div(daysOutstanding).toDecimalPlaces(0).toString(),
                closingBalance: Prisma.Decimal.max(balance, 0).toString(),
                lostInterest: lostInterest.toDecimalPlaces(0).toString(),
                overdueLostInterest: overdueLostInterest.toDecimalPlaces(0).toString(),
            })
            customers.set(item.customer.id, customer)
        }

        const dayCount = periodDays.length || 1
        const rows = [...customers.values()]
            .map((row) => ({
                customer: row.customer,
                averageDebt: row.debtDays.div(dayCount).toDecimalPlaces(0).toString(),
                debtDays: row.debtDays.toDecimalPlaces(0).toString(),
                closingDebt: row.closingDebt.toString(),
                lostInterest: row.lostInterest.toDecimalPlaces(0).toString(),
                overdueLostInterest: row.overdueLostInterest.toDecimalPlaces(0).toString(),
                items: row.items.sort((a: any, b: any) => Number(b.lostInterest) - Number(a.lostInterest)),
            }))
            .sort((a, b) => Number(b.lostInterest) - Number(a.lostInterest))

        const sum = (field: 'lostInterest' | 'overdueLostInterest' | 'averageDebt' | 'closingDebt') =>
            rows.reduce((total, row) => total.plus(row[field]), new Prisma.Decimal(0)).toString()

        const firstKey = periodDays[0]
        const lastKey = periodDays[periodDays.length - 1]
        const missing = [...missingRateDays].sort()
        return {
            fromDate: firstKey ?? dayKeyOf(from),
            toDate: lastKey ?? dayKeyOf(to),
            dayCount: periodDays.length,
            // Các mức lãi đã dùng trong kỳ — mức đang hiệu lực đầu kỳ và mọi mốc đổi giữa kỳ.
            ratesUsed: rateTable
                .filter((row, index) => row.key <= lastKey && (rateTable[index + 1]?.key ?? '9999-12-31') > firstKey)
                .map((row) => ({ effectiveFrom: row.key, annualRate: row.rate.toString() })),
            // Ngày còn nợ mà chưa có lãi suất: tiền lãi những ngày đó đang tính là 0, phải báo ra.
            missingRate: missing.length ? { days: missing.length, fromDate: missing[0], toDate: missing[missing.length - 1] } : null,
            totals: {
                lostInterest: sum('lostInterest'),
                overdueLostInterest: sum('overdueLostInterest'),
                averageDebt: sum('averageDebt'),
                closingDebt: sum('closingDebt'),
            },
            items: rows,
        }
    }

    private documentNoOf(item: {
        salesInvoice: { invoiceNoInternal: string; misaInvoiceNo: string | null } | null
        salesOrder: { orderNo: string } | null
        withdrawalRequest: { requestNo: string } | null
        legacyReference: string | null
        note: string | null
        installmentNo: number
    }) {
        const base =
            item.salesInvoice?.misaInvoiceNo ??
            item.salesInvoice?.invoiceNoInternal ??
            item.salesOrder?.orderNo ??
            item.withdrawalRequest?.requestNo ??
            item.legacyReference ??
            item.note ??
            '—'
        return item.installmentNo > 1 ? `${base} (đợt ${item.installmentNo})` : base
    }
}
