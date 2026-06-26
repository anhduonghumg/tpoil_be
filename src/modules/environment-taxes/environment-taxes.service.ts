import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateEnvironmentTaxDto } from './dto/create-environment-tax.dto'
import { QueryEnvironmentTaxesDto } from './dto/query-environment-taxes.dto'
import { UpdateEnvironmentTaxDto } from './dto/update-environment-tax.dto'

@Injectable()
export class EnvironmentTaxesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: QueryEnvironmentTaxesDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 20
        const skip = (page - 1) * pageSize
        const where: Prisma.EnvironmentalTaxRateWhereInput = {}

        if (query.productId) {
            where.productId = query.productId
        }

        if (query.status) {
            where.status = this.normalizeStatus(query.status)
        }

        if (query.fromDate) {
            const fromDate = this.toDateOnly(query.fromDate, 'INVALID_FROM_DATE')
            where.OR = [{ effectiveTo: null }, { effectiveTo: { gte: fromDate } }]
        }

        if (query.toDate) {
            const toDate = this.toDateOnly(query.toDate, 'INVALID_TO_DATE')
            where.effectiveFrom = { lte: toDate }
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.environmentalTaxRate.findMany({
                where,
                include: {
                    product: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                        },
                    },
                },
                orderBy: [{ product: { name: 'asc' } }, { effectiveFrom: 'desc' }],
                skip,
                take: pageSize,
            }),
            this.prisma.environmentalTaxRate.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        }
    }

    async create(dto: CreateEnvironmentTaxDto) {
        const productId = dto.productId
        const effectiveFrom = this.toDateOnly(dto.effectiveFrom, 'INVALID_EFFECTIVE_FROM')
        const effectiveTo = dto.effectiveTo ? this.toDateOnly(dto.effectiveTo, 'INVALID_EFFECTIVE_TO') : null
        const status = this.normalizeStatus(dto.status)

        this.assertValidRange(effectiveFrom, effectiveTo)
        await this.assertProductExists(productId)
        await this.assertNoOverlap({ productId, effectiveFrom, effectiveTo, status })

        const created = await this.prisma.environmentalTaxRate.create({
            data: {
                productId,
                effectiveFrom,
                effectiveTo,
                taxVndPerLiter: new Prisma.Decimal(dto.taxVndPerLiter),
                status,
                note: dto.note?.trim() || null,
            },
        })

        return this.detail(created.id)
    }

    async update(id: string, dto: UpdateEnvironmentTaxDto) {
        const current = await this.detail(id)
        const productId = dto.productId ?? current.productId
        const effectiveFrom = dto.effectiveFrom ? this.toDateOnly(dto.effectiveFrom, 'INVALID_EFFECTIVE_FROM') : current.effectiveFrom
        const effectiveTo = dto.effectiveTo === undefined ? current.effectiveTo : dto.effectiveTo ? this.toDateOnly(dto.effectiveTo, 'INVALID_EFFECTIVE_TO') : null
        const status = dto.status === undefined ? current.status : this.normalizeStatus(dto.status)
        const taxVndPerLiter = dto.taxVndPerLiter === undefined ? current.taxVndPerLiter : new Prisma.Decimal(dto.taxVndPerLiter)
        const note = dto.note === undefined ? current.note : dto.note?.trim() || null

        this.assertValidRange(effectiveFrom, effectiveTo)
        await this.assertProductExists(productId)
        await this.assertNoOverlap({ productId, effectiveFrom, effectiveTo, status, excludeId: id })

        await this.prisma.environmentalTaxRate.update({
            where: { id },
            data: {
                productId,
                effectiveFrom,
                effectiveTo,
                taxVndPerLiter,
                status,
                note,
            },
        })

        return this.detail(id)
    }

    async delete(id: string) {
        const found = await this.prisma.environmentalTaxRate.findUnique({
            where: { id },
            select: { id: true },
        })

        if (!found) {
            throw new NotFoundException('ENVIRONMENT_TAX_NOT_FOUND')
        }

        await this.prisma.environmentalTaxRate.delete({
            where: { id },
        })

        return { id }
    }

    async lookup(query: { productId: string; date: string }) {
        if (!query.productId) {
            throw new BadRequestException('PRODUCT_ID_REQUIRED')
        }

        if (!query.date) {
            throw new BadRequestException('TAX_DATE_REQUIRED')
        }

        const date = this.toDateOnly(query.date, 'INVALID_TAX_DATE')

        return this.prisma.environmentalTaxRate.findFirst({
            where: {
                productId: query.productId,
                status: 'ACTIVE',
                effectiveFrom: {
                    lte: date,
                },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: date } }],
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
            orderBy: {
                effectiveFrom: 'desc',
            },
        })
    }

    private async detail(id: string) {
        const item = await this.prisma.environmentalTaxRate.findUnique({
            where: { id },
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

        if (!item) {
            throw new NotFoundException('ENVIRONMENT_TAX_NOT_FOUND')
        }

        return item
    }

    private async assertProductExists(productId: string) {
        const product = await this.prisma.product.findUnique({
            where: { id: productId },
            select: { id: true },
        })

        if (!product) {
            throw new NotFoundException('PRODUCT_NOT_FOUND')
        }
    }

    private async assertNoOverlap(args: { productId: string; effectiveFrom: Date; effectiveTo: Date | null; status: string; excludeId?: string }) {
        if (args.status !== 'ACTIVE') return

        const activeTo = args.effectiveTo ?? new Date('9999-12-31T00:00:00.000Z')

        const existing = await this.prisma.environmentalTaxRate.findFirst({
            where: {
                productId: args.productId,
                status: 'ACTIVE',
                ...(args.excludeId ? { id: { not: args.excludeId } } : {}),
                effectiveFrom: {
                    lte: activeTo,
                },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: args.effectiveFrom } }],
            },
            select: { id: true },
        })

        if (existing) {
            throw new ConflictException('ENVIRONMENT_TAX_DATE_RANGE_OVERLAP')
        }
    }

    private assertValidRange(effectiveFrom: Date, effectiveTo: Date | null) {
        if (effectiveTo && effectiveTo.getTime() < effectiveFrom.getTime()) {
            throw new BadRequestException('INVALID_EFFECTIVE_RANGE')
        }
    }

    private normalizeStatus(value?: string) {
        const status = (value?.trim() || 'ACTIVE').toUpperCase()
        if (!['ACTIVE', 'INACTIVE'].includes(status)) {
            throw new BadRequestException('INVALID_ENVIRONMENT_TAX_STATUS')
        }
        return status
    }

    private toDateOnly(value: string | Date, errorCode: string) {
        if (value instanceof Date) return value

        const date = new Date(`${value}T00:00:00.000Z`)

        if (Number.isNaN(date.getTime())) {
            throw new BadRequestException(errorCode)
        }

        return date
    }
}
