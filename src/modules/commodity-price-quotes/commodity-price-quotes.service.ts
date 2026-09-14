import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PriceSource, Prisma } from '@prisma/client'
import { BulkUpsertCommodityPriceQuotesDto } from './dto/bulk-upsert-commodity-price-quotes.dto'
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

    /**
     * Lưu nhiều ô giá một lượt (dùng cho chức năng dán nhanh từ bảng tính).
     *
     * Tất cả nằm trong một transaction: dán 90 ô mà hỏng ở ô thứ 50 thì không được
     * để lại 49 ô đã lưu — người dùng sẽ không biết phải dán lại từ đâu.
     */
    async bulkUpsert(dto: BulkUpsertCommodityPriceQuotesDto) {
        const productIds = [...new Set(dto.items.map((item) => item.productId))]
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true },
        })

        if (products.length !== productIds.length) {
            throw new NotFoundException('PRODUCT_NOT_FOUND')
        }

        // Cùng một ô (mặt hàng + ngày) xuất hiện hai lần trong cùng lô sẽ làm Prisma
        // báo lỗi ghi trùng trong transaction, nên chốt lấy giá trị sau cùng.
        const deduped = new Map<string, (typeof dto.items)[number]>()
        for (const item of dto.items) {
            deduped.set(`${item.productId}_${item.quoteDate}`, item)
        }

        const saved = await this.prisma.$transaction(
            [...deduped.values()].map((item) => {
                const quoteDate = this.toDateOnly(item.quoteDate)
                return this.prisma.commodityPriceQuote.upsert({
                    where: {
                        productId_quoteDate_source: {
                            productId: item.productId,
                            quoteDate,
                            source: PriceSource.PLATTS,
                        },
                    },
                    create: {
                        productId: item.productId,
                        quoteDate,
                        source: PriceSource.PLATTS,
                        priceUsdPerBbl: new Prisma.Decimal(item.priceUsdPerBbl),
                        note: item.note?.trim() || null,
                    },
                    update: {
                        priceUsdPerBbl: new Prisma.Decimal(item.priceUsdPerBbl),
                        note: item.note?.trim() || null,
                    },
                    select: { id: true },
                })
            }),
        )

        return { saved: saved.length }
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
