import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PriceSource, Prisma } from '@prisma/client'
import { QueryCommodityPriceQuotesDto } from './dto/query-commodity-price-quotes.dto'
import { UpsertCommodityPriceQuoteDto } from './dto/upsert-commodity-price-quote.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class CommodityPriceQuotesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: QueryCommodityPriceQuotesDto) {
        const [year, month] = query.month.split('-').map(Number)

        if (!year || !month || month < 1 || month > 12) {
            throw new BadRequestException('INVALID_MONTH')
        }

        const start = new Date(Date.UTC(year, month - 1, 1))
        const end = new Date(Date.UTC(year, month, 1))

        return this.prisma.commodityPriceQuote.findMany({
            where: {
                source: PriceSource.PLATTS,
                quoteDate: {
                    gte: start,
                    lt: end,
                },
                ...(query.productId ? { productId: query.productId } : {}),
            },
            include: {
                product: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                    },
                },
            },
            orderBy: [{ quoteDate: 'asc' }, { productId: 'asc' }],
        })
    }

    async upsert(dto: UpsertCommodityPriceQuoteDto) {
        const product = await this.prisma.product.findUnique({
            where: { id: dto.productId },
            select: { id: true },
        })

        if (!product) {
            throw new NotFoundException('PRODUCT_NOT_FOUND')
        }

        const quoteDate = this.toDateOnly(dto.quoteDate)

        return this.prisma.commodityPriceQuote.upsert({
            where: {
                productId_quoteDate_source: {
                    productId: dto.productId,
                    quoteDate,
                    source: PriceSource.PLATTS,
                },
            },
            create: {
                productId: dto.productId,
                quoteDate,
                source: PriceSource.PLATTS,
                priceUsdPerBbl: new Prisma.Decimal(dto.priceUsdPerBbl),
                note: dto.note?.trim() || null,
            },
            update: {
                priceUsdPerBbl: new Prisma.Decimal(dto.priceUsdPerBbl),
                note: dto.note?.trim() || null,
            },
            include: {
                product: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                    },
                },
            },
        })
    }

    async delete(id: string) {
        const found = await this.prisma.commodityPriceQuote.findUnique({
            where: { id },
            select: { id: true },
        })

        if (!found) {
            throw new NotFoundException('PRICE_QUOTE_NOT_FOUND')
        }

        await this.prisma.commodityPriceQuote.delete({
            where: { id },
        })

        return { id }
    }

    private toDateOnly(value: string) {
        const date = new Date(`${value}T00:00:00.000Z`)

        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException('INVALID_QUOTE_DATE')
        }

        return date
    }
}
