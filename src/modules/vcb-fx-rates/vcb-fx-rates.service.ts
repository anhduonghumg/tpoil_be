import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import axios from 'axios'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { FetchVcbFxRateDto } from './dto/fetch-vcb-fx-rate.dto'
import { QueryVcbFxRatesDto } from './dto/query-vcb-fx-rates.dto'
import { UpsertVcbFxRateDto } from './dto/upsert-vcb-fx-rate.dto'

@Injectable()
export class VcbFxRatesService {
    private readonly vcbXmlUrl = 'https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx?b=10'

    constructor(private readonly prisma: PrismaService) {}

    async list(query: QueryVcbFxRatesDto) {
        const [year, month] = query.month.split('-').map(Number)

        if (!year || !month || month < 1 || month > 12) {
            throw new BadRequestException('INVALID_MONTH')
        }

        const start = new Date(Date.UTC(year, month - 1, 1))
        const end = new Date(Date.UTC(year, month, 1))
        const bankCode = this.normalizeBankCode(query.bankCode)
        const currencyCode = this.normalizeCurrencyCode(query.currencyCode)

        return this.prisma.vcbFxRate.findMany({
            where: {
                rateDate: {
                    gte: start,
                    lt: end,
                },
                bankCode,
                currencyCode,
            },
            orderBy: {
                rateDate: 'asc',
            },
        })
    }

    async upsert(dto: UpsertVcbFxRateDto) {
        const rateDate = this.toDateOnly(dto.rateDate, 'INVALID_RATE_DATE')
        const bankCode = this.normalizeBankCode(dto.bankCode)
        const currencyCode = this.normalizeCurrencyCode(dto.currencyCode)

        return this.upsertRate({
            rateDate,
            bankCode,
            currencyCode,
            cashBuyRate: dto.cashBuyRate,
            transferBuyRate: dto.transferBuyRate,
            sellRate: dto.sellRate,
            source: 'MANUAL',
            fetchedAt: null,
            rawPayload: null,
            note: dto.note?.trim() || null,
        })
    }

    async fetchFromVcb(dto: FetchVcbFxRateDto) {
        const currencyCode = this.normalizeCurrencyCode(dto.currencyCode)
        const rateDate = dto.rateDate ? this.toDateOnly(dto.rateDate, 'INVALID_RATE_DATE') : this.todayDateOnly()
        const fetchedAt = new Date()

        const response = await axios.get(this.vcbXmlUrl, {
            timeout: 15000,
            responseType: 'text',
        })

        const xml = String(response.data || '')
        const parsed = this.parseVcbXmlRate(xml, currencyCode)

        if (!parsed.sellRate) {
            throw new BadRequestException('VCB_SELL_RATE_NOT_FOUND')
        }

        return this.upsertRate({
            rateDate,
            bankCode: 'VCB',
            currencyCode,
            cashBuyRate: parsed.cashBuyRate ?? undefined,
            transferBuyRate: parsed.transferBuyRate ?? undefined,
            sellRate: parsed.sellRate,
            source: 'VCB_API',
            fetchedAt,
            rawPayload: parsed.rawPayload,
            note: `Lấy từ VCB lúc ${fetchedAt.toISOString()}`,
        })
    }

    async delete(id: string) {
        const found = await this.prisma.vcbFxRate.findUnique({
            where: { id },
            select: { id: true },
        })

        if (!found) {
            throw new NotFoundException('VCB_FX_RATE_NOT_FOUND')
        }

        await this.prisma.vcbFxRate.delete({
            where: { id },
        })

        return { id }
    }

    async findForDate(query: { date: string; bankCode?: string; currencyCode?: string }) {
        const rateDate = this.toDateOnly(query.date, 'INVALID_RATE_DATE')
        const bankCode = this.normalizeBankCode(query.bankCode)
        const currencyCode = this.normalizeCurrencyCode(query.currencyCode)

        return this.prisma.vcbFxRate.findFirst({
            where: {
                rateDate: {
                    lte: rateDate,
                },
                bankCode,
                currencyCode,
            },
            orderBy: {
                rateDate: 'desc',
            },
        })
    }

    private upsertRate(input: {
        rateDate: Date
        bankCode: string
        currencyCode: string
        cashBuyRate?: number | null
        transferBuyRate?: number | null
        sellRate: number
        source: string
        fetchedAt?: Date | null
        rawPayload?: Prisma.InputJsonValue | null
        note?: string | null
    }) {
        return this.prisma.vcbFxRate.upsert({
            where: {
                rateDate_bankCode_currencyCode: {
                    rateDate: input.rateDate,
                    bankCode: input.bankCode,
                    currencyCode: input.currencyCode,
                },
            },
            create: {
                rateDate: input.rateDate,
                bankCode: input.bankCode,
                currencyCode: input.currencyCode,
                cashBuyRate: this.toDecimalOrNull(input.cashBuyRate),
                transferBuyRate: this.toDecimalOrNull(input.transferBuyRate),
                sellRate: new Prisma.Decimal(input.sellRate),
                source: input.source,
                fetchedAt: input.fetchedAt ?? null,
                rawPayload: this.toJsonValue(input.rawPayload),
                note: input.note ?? null,
            },
            update: {
                cashBuyRate: this.toDecimalOrNull(input.cashBuyRate),
                transferBuyRate: this.toDecimalOrNull(input.transferBuyRate),
                sellRate: new Prisma.Decimal(input.sellRate),
                source: input.source,
                fetchedAt: input.fetchedAt ?? null,
                rawPayload: this.toJsonValue(input.rawPayload),
                note: input.note ?? null,
            },
        })
    }

    private toJsonValue(value?: Prisma.InputJsonValue | null) {
        if (value === undefined) return undefined
        return value === null ? Prisma.JsonNull : value
    }

    private parseVcbXmlRate(xml: string, currencyCode: string) {
        const tags = xml.match(/<Exrate\b[^>]*>/gi) ?? []

        for (const tag of tags) {
            const attrs = this.parseXmlAttrs(tag)
            if ((attrs.CurrencyCode || '').toUpperCase() !== currencyCode) continue

            return {
                cashBuyRate: this.parseRateNumber(attrs.Buy),
                transferBuyRate: this.parseRateNumber(attrs.Transfer),
                sellRate: this.parseRateNumber(attrs.Sell),
                rawPayload: attrs,
            }
        }

        throw new NotFoundException('VCB_CURRENCY_RATE_NOT_FOUND')
    }

    private parseXmlAttrs(tag: string) {
        const attrs: Record<string, string> = {}
        const pattern = /([A-Za-z0-9_:-]+)="([^"]*)"/g
        let match: RegExpExecArray | null

        while ((match = pattern.exec(tag))) {
            attrs[match[1]] = match[2]
        }

        return attrs
    }

    private parseRateNumber(value?: string) {
        if (!value || value === '-') return null
        const normalized = value.replaceAll(',', '').trim()
        const n = Number(normalized)
        return Number.isFinite(n) ? n : null
    }

    private normalizeBankCode(value?: string) {
        return (value?.trim() || 'VCB').toUpperCase()
    }

    private normalizeCurrencyCode(value?: string) {
        return (value?.trim() || 'USD').toUpperCase()
    }

    private toDecimalOrNull(value?: number | null) {
        return value === undefined || value === null ? null : new Prisma.Decimal(value)
    }

    private todayDateOnly() {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Ho_Chi_Minh',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(new Date())

        const year = parts.find((x) => x.type === 'year')?.value
        const month = parts.find((x) => x.type === 'month')?.value
        const day = parts.find((x) => x.type === 'day')?.value

        return this.toDateOnly([year, month, day].join('-'), 'INVALID_RATE_DATE')
    }

    private toDateOnly(value: string, errorCode: string) {
        const date = new Date(`${value}T00:00:00.000Z`)

        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException(errorCode)
        }

        return date
    }
}