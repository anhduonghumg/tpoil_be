import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ContractType as ContractTypeModel } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ContractTypeListQueryDto } from './dto/contract-type-list-query.dto'
import { CreateContractTypeDto } from './dto/create-contract-type.dto'
import { UpdateContractTypeDto } from './dto/update-contract-type.dto'

@Injectable()
export class ContractTypesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: ContractTypeListQueryDto) {
        const { page = 1, pageSize = 20, keyword, isActive } = query

        const where: Prisma.ContractTypeWhereInput = {}

        if (keyword) {
            where.OR = [
                { code: { contains: keyword, mode: 'insensitive' } },
                { name: { contains: keyword, mode: 'insensitive' } },
                { description: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        if (isActive === true || isActive === false) {
            where.isActive = isActive
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.contractType.findMany({
                where,
                orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.contractType.count({ where }),
        ])
        // console.log(items)
        return {
            items,
            total,
            page,
            pageSize,
        }
    }

    async getAll() {
        const list = await this.prisma.contractType.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
            select: { id: true, code: true, name: true },
        })
        return list ?? []
    }

    async findOne(id: string): Promise<ContractTypeModel> {
        const ct = await this.prisma.contractType.findUnique({ where: { id, deletedAt: null } })
        // console.log('ct', ct)
        if (!ct) throw new NotFoundException('Không tìm thấy loại hợp đồng')
        return ct
    }

    async create(dto: CreateContractTypeDto) {
        const code = dto.code
            .trim()
            .toUpperCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Z0-9]/g, '')

        return this.prisma.contractType.create({
            data: {
                code,
                name: dto.name.trim(),
                description: dto.description?.trim() || null,
                isActive: dto.isActive ?? true,
                sortOrder: dto.sortOrder,
            },
        })
    }

    async update(id: string, dto: UpdateContractTypeDto) {
        const existing = await this.prisma.contractType.findUnique({ where: { id, deletedAt: null } })
        if (!existing) throw new NotFoundException('Không tìm thấy loại hợp đồng')

        const data: Prisma.ContractTypeUpdateInput = {}

        if (dto.code !== undefined) {
            data.code = dto.code
                .trim()
                .toUpperCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^A-Z0-9]/g, '')
        }
        if (dto.name !== undefined) data.name = dto.name.trim()
        if (dto.description !== undefined) data.description = dto.description?.trim() || null
        if (dto.isActive !== undefined) data.isActive = dto.isActive
        if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder

        return this.prisma.contractType.update({
            where: { id },
            data,
        })
    }

    async delete(id: string) {
        const count = await this.prisma.contract.count({
            where: { contractTypeId: id, deletedAt: null },
        })
        if (count > 0) {
            throw new BadRequestException('Loại hợp đồng đang được sử dụng, không thể xoá')
        }

        await this.prisma.contractType.delete({
            where: { id },
        })

        return { success: true }
    }

    async deleteMultiple(ids: string[]) {
        if (!ids?.length) return { deleted: 0 }

        const countUsing = await this.prisma.contract.count({
            where: { contractTypeId: { in: ids }, deletedAt: null },
        })

        if (countUsing > 0) {
            throw new BadRequestException('Một số loại hợp đồng đang được sử dụng, không thể xoá')
        }

        const res = await this.prisma.contractType.deleteMany({
            where: { id: { in: ids } },
        })

        return { deleted: res.count }
    }
}
