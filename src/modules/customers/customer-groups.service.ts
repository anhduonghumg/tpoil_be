import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CustomerGroup, Prisma } from '@prisma/client'
import { CustomerGroupListQueryDto } from './dto/customer-group-list-query.dto'
import { CustomerGroupSelectQueryDto } from './dto/customer-group-select-query.dto'
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto'
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class CustomerGroupsService {
    constructor(private readonly prisma: PrismaService) {}

    async list(q: CustomerGroupListQueryDto): Promise<{
        items: CustomerGroup[]
        page: number
        pageSize: number
        total: number
    }> {
        const page = q.page ?? 1
        const pageSize = q.pageSize ?? 20
        const keyword = (q.keyword ?? '').trim()

        const where: Prisma.CustomerGroupWhereInput = keyword
            ? {
                  OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }],
              }
            : {}

        const [total, items] = await Promise.all([
            this.prisma.customerGroup.count({ where }),
            this.prisma.customerGroup.findMany({
                where,
                orderBy: [{ code: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ])

        return { items, page, pageSize, total }
    }

    async select(q: CustomerGroupSelectQueryDto): Promise<Array<Pick<CustomerGroup, 'id' | 'code' | 'name'>>> {
        const keyword = (q.keyword ?? '').trim()

        const where: Prisma.CustomerGroupWhereInput = keyword
            ? {
                  OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }],
              }
            : {}

        const rows = await this.prisma.customerGroup.findMany({
            where,
            orderBy: [{ code: 'asc' }],
            take: 50,
            select: { id: true, code: true, name: true },
        })

        return rows
    }

    async detail(id: string): Promise<CustomerGroup> {
        const row = await this.prisma.customerGroup.findUnique({ where: { id } })
        if (!row) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y nhÃ³m khÃ¡ch hÃ ng')
        return row
    }

    async create(dto: CreateCustomerGroupDto): Promise<CustomerGroup> {
        const code = dto.code.trim().toUpperCase()

        try {
            return await this.prisma.customerGroup.create({
                data: {
                    code,
                    name: dto.name?.trim(),
                    note: dto.note?.trim(),
                },
            })
        } catch (e: unknown) {
            throw new BadRequestException('MÃ£ Group Ä‘Ã£ tá»“n táº¡i')
        }
    }

    async update(id: string, dto: UpdateCustomerGroupDto): Promise<CustomerGroup> {
        const existing = await this.prisma.customerGroup.findUnique({ where: { id } })
        if (!existing) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y nhÃ³m khÃ¡ch hÃ ng')

        const code = dto.code ? dto.code.trim().toUpperCase() : undefined

        if (code && code !== existing.code) {
            const dup = await this.prisma.customerGroup.findUnique({ where: { code } })
            if (dup) throw new BadRequestException('MÃ£ Group Ä‘Ã£ tá»“n táº¡i')
        }

        return this.prisma.customerGroup.update({
            where: { id },
            data: {
                code,
                name: dto.name?.trim(),
                note: dto.note?.trim(),
            },
        })
    }

    async remove(id: string): Promise<CustomerGroup> {
        const existing = await this.prisma.customerGroup.findUnique({ where: { id } })
        if (!existing) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y nhÃ³m khÃ¡ch hÃ ng')

        const used = await this.prisma.party.count({ where: { groupId: id, deletedAt: null } })
        if (used > 0) throw new BadRequestException('NhÃ³m Ä‘ang Ä‘Æ°á»£c sá»­ dá»¥ng, khÃ´ng thá»ƒ xoÃ¡')

        return this.prisma.customerGroup.delete({ where: { id } })
    }
}
