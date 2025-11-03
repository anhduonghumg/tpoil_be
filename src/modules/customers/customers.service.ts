import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { CreateCustomerDto, CustomerRole, CustomerStatus } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { QueryCustomerDto } from './dto/query-customer.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { removeDiacriticsToUpperNoSpace } from 'src/utils/text'

@Injectable()
export class CustomersService {
    constructor(private prisma: PrismaService) {}

    async findAll(q: QueryCustomerDto) {
        const page = Math.max(parseInt(q.page || '1', 10), 1)
        const pageSize = Math.min(Math.max(parseInt(q.pageSize || '20', 10), 1), 100)
        const where: any = { deletedAt: null }

        if (q.keyword) {
            where.OR = [
                { code: { contains: q.keyword, mode: 'insensitive' } },
                { name: { contains: q.keyword, mode: 'insensitive' } },
                { taxCode: { contains: q.keyword, mode: 'insensitive' } },
            ]
        }
        if (q.status) where.status = q.status
        if (q.role) where.roles = { has: q.role as CustomerRole }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.customer.findMany({
                where,
                orderBy: { updatedAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.customer.count({ where }),
        ])
        return { items, total, page, pageSize }
    }

    async findOne(id: string) {
        const customer = await this.prisma.customer.findUnique({ where: { id, deletedAt: null } })
        if (!customer) throw new NotFoundException('Customer not found')
        return customer
    }

    async create(body: CreateCustomerDto) {
        const code = body.code?.trim() || (await this.generateCodeInternal(body.name))
        const normalized = removeDiacriticsToUpperNoSpace(code)
        const exist = await this.prisma.customer.findUnique({ where: { code: normalized } })
        if (exist) throw new ConflictException('Customer code already exists')
        const data: any = { ...body, code: normalized }
        return this.prisma.customer.create({ data })
    }

    async update(id: string, body: UpdateCustomerDto) {
        const found = await this.findOne(id)
        if (body.code && body.code !== found.code) {
            const normalized = removeDiacriticsToUpperNoSpace(body.code)
            const dup = await this.prisma.customer.findUnique({ where: { code: normalized } })
            if (dup) throw new ConflictException('Customer code already exists')
            body.code = normalized
        }

        return this.prisma.customer.update({ where: { id }, data: body })
    }

    async softDelete(id: string) {
        await this.findOne(id)
        return this.prisma.customer.update({ where: { id }, data: { deletedAt: new Date() } })
    }

    async generateCode(customerId?: string) {
        if (!customerId) {
            const code = await this.generateCodeInternal()
            return { code }
        }
        const customer = await this.findOne(customerId)
        const code = await this.generateCodeInternal(customer.name)
        await this.prisma.customer.update({ where: { id: customerId }, data: { code } })
        return { code }
    }

    private async generateCodeInternal(hintName?: string) {
        const prefix = 'KH'
        const year = new Date().getFullYear()
        const base = hintName ? removeDiacriticsToUpperNoSpace(hintName).slice(0, 8) : ''
        const seq =
            (
                await this.prisma.$queryRaw<Array<{ seq: number }>>`
      SELECT COALESCE(MAX(CAST(SPLIT_PART(code, '-', 3) AS INTEGER)), 0) AS seq
      FROM "Customer" WHERE code LIKE ${`${prefix}-${year}-%`}
    `
            )[0]?.seq ?? 0

        const next = String(seq + 1).padStart(4, '0')
        return `${prefix}-${year}-${next}${base ? '-' + base : ''}`
    }
}
