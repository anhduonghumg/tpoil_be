import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ProductUpdateDto } from './dto/product-update.dto'
import { ProductCreateDto } from './dto/product-create.dto'
import { ProductListQuery } from './dto/product-list.query'

@Injectable()
export class ProductsService {
    constructor(private readonly prisma: PrismaService) {}

    async select(q: { keyword?: string; limit?: number }) {
        const limit = Math.min(50, Math.max(1, q.limit ?? 20))
        const keyword = (q.keyword ?? '').trim()

        const where = keyword
            ? {
                  OR: [{ name: { contains: keyword, mode: 'insensitive' as const } }, { code: { contains: keyword, mode: 'insensitive' as const } }],
              }
            : {}

        const items = await this.prisma.product.findMany({
            where,
            take: limit,
            orderBy: [{ name: 'asc' }],
            select: {
                id: true,
                code: true,
                name: true,
                uom: true,
            },
        })

        return items.map((x) => ({
            id: x.id,
            code: x.code ?? '',
            name: x.name,
            uom: x.uom,
            label: `${x.name}${x.code ? ` (${x.code})` : ''}`,
        }))
    }

    list(query: ProductListQuery) {
        const { keyword } = query

        return this.prisma.product.findMany({
            where: keyword
                ? {
                      OR: [{ name: { contains: keyword, mode: 'insensitive' } }, { code: { contains: keyword, mode: 'insensitive' } }],
                  }
                : undefined,
            orderBy: { name: 'asc' },
        })
    }

    all() {
        return this.prisma.product.findMany({
            select: {
                id: true,
                code: true,
                name: true,
                nameMisa: true,
                uom: true,
            },
            orderBy: { name: 'asc' },
        })
    }

    async detail(id: string) {
        const product = await this.prisma.product.findUnique({ where: { id } })
        if (!product) throw new BadRequestException('Product not found')
        return product
    }

    create(dto: ProductCreateDto) {
        return this.prisma.product.create({
            data: {
                code: dto.code,
                name: dto.name,
                nameMisa: dto.nameMisa,
                uom: dto.uom,
            },
        })
    }

    async update(id: string, dto: ProductUpdateDto) {
        await this.detail(id)

        return this.prisma.product.update({
            where: { id },
            data: {
                code: dto.code,
                name: dto.name,
                nameMisa: dto.nameMisa,
                uom: dto.uom,
            },
        })
    }
}
