import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateVatRateDto } from './dto/create-vat-rate.dto'
import { UpdateVatRateDto } from './dto/update-vat-rate.dto'

@Injectable()
export class VatRatesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(isActive?: string) {
        const where: Prisma.VatRateWhereInput = {}
        if (isActive !== undefined) where.isActive = isActive === 'true'
        return this.prisma.vatRate.findMany({ where, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
    }

    async select() {
        return this.prisma.vatRate.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
    }

    async create(dto: CreateVatRateDto) {
        const data = this.normalize(dto)
        try {
            return await this.prisma.$transaction(async (tx) => {
                if (data.isDefault) await tx.vatRate.updateMany({ data: { isDefault: false } })
                return tx.vatRate.create({ data })
            })
        } catch (error) {
            if (this.isUniqueError(error)) throw new ConflictException('VAT_RATE_NAME_EXISTS')
            throw error
        }
    }

    async update(id: string, dto: UpdateVatRateDto) {
        const current = await this.prisma.vatRate.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('VAT_RATE_NOT_FOUND')

        const data = this.normalize({
            name: dto.name ?? current.name,
            rate: dto.rate ?? Number(current.rate),
            isExempt: dto.isExempt ?? current.isExempt,
            isActive: dto.isActive ?? current.isActive,
            isDefault: dto.isDefault ?? current.isDefault,
            sortOrder: dto.sortOrder ?? current.sortOrder,
        })

        try {
            return await this.prisma.$transaction(async (tx) => {
                if (data.isDefault) await tx.vatRate.updateMany({ where: { id: { not: id } }, data: { isDefault: false } })
                return tx.vatRate.update({ where: { id }, data })
            })
        } catch (error) {
            if (this.isUniqueError(error)) throw new ConflictException('VAT_RATE_NAME_EXISTS')
            throw error
        }
    }

    async delete(id: string) {
        const found = await this.prisma.vatRate.findUnique({ where: { id }, select: { id: true } })
        if (!found) throw new NotFoundException('VAT_RATE_NOT_FOUND')
        await this.prisma.vatRate.delete({ where: { id } })
        return { id }
    }

    private normalize(dto: CreateVatRateDto) {
        const name = dto.name?.trim()
        if (!name) throw new BadRequestException('VAT_RATE_NAME_REQUIRED')

        const isExempt = dto.isExempt === true
        const rate = isExempt ? 0 : Number(dto.rate)
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
            throw new BadRequestException('INVALID_VAT_RATE')
        }

        return {
            name,
            rate: new Prisma.Decimal(rate),
            isExempt,
            isActive: dto.isActive ?? true,
            isDefault: dto.isDefault ?? false,
            sortOrder: dto.sortOrder ?? 0,
        }
    }

    private isUniqueError(error: unknown) {
        return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    }
}
