import { Injectable, NotFoundException } from '@nestjs/common'
import { CustomerListQueryDto } from './dto/customer-list-query.dto'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import dayjs from 'dayjs'
import { CustomerSelectQueryDto } from './dto/customer-select-query.dto'

@Injectable()
export class CustomersService {
    constructor(private readonly prisma: PrismaService) {}

    // List + filter + pagination
    async list(query: CustomerListQueryDto) {
        const { keyword, type, status, salesOwnerEmpId, accountingOwnerEmpId, legalOwnerEmpId, page = 1, pageSize = 20 } = query

        const where: Prisma.CustomerWhereInput = {
            deletedAt: null,
            ...(keyword
                ? {
                      OR: [
                          { code: { contains: keyword, mode: 'insensitive' } },
                          { name: { contains: keyword, mode: 'insensitive' } },
                          { taxCode: { contains: keyword, mode: 'insensitive' } },
                          { contactPhone: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
            ...(type ? { type } : {}),
            ...(status ? { status } : {}),
            ...(salesOwnerEmpId ? { salesOwnerEmpId } : {}),
            ...(accountingOwnerEmpId ? { accountingOwnerEmpId } : {}),
            ...(legalOwnerEmpId ? { legalOwnerEmpId } : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.customer.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.customer.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
        }
    }

    async select(query: CustomerSelectQueryDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 50
        const keyword = query.keyword?.trim()

        const where: Prisma.CustomerWhereInput = {
            deletedAt: null,
        }

        if (keyword) {
            where.OR = [
                { code: { contains: keyword, mode: 'insensitive' } },
                { name: { contains: keyword, mode: 'insensitive' } },
                { taxCode: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.customer.findMany({
                where,
                orderBy: {
                    name: 'asc',
                },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    taxCode: true,
                },
            }),
            this.prisma.customer.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
        }
    }

    async generateCode() {
        const now = dayjs()
        const prefix = `C${now.format('YYYYMM')}`

        const last = await this.prisma.customer.findFirst({
            where: { code: { startsWith: prefix } },
            orderBy: { code: 'desc' },
            select: { code: true },
        })

        let nextNumber = 1
        if (last?.code) {
            const tail = last.code.slice(prefix.length)
            const parsed = parseInt(tail, 10)
            if (!isNaN(parsed)) nextNumber = parsed + 1
        }

        const code = `${prefix}${String(nextNumber).padStart(4, '0')}`
        return { code }
    }

    // Create
    async create(dto: CreateCustomerDto) {
        let code = dto.code

        // Nếu FE không gửi code hoặc gửi rỗng → BE tự gen
        if (!code || !code.trim()) {
            const gen = await this.generateCode()
            code = gen.code
        }
        const data: Prisma.CustomerCreateInput = {
            code,
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified ?? false,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            roles: dto.roles,
            type: dto.type,
            billingAddress: dto.billingAddress,
            shippingAddress: dto.shippingAddress,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            creditLimit: dto.creditLimit ?? undefined,
            tempLimit: dto.tempLimit ?? undefined,
            tempFrom: dto.tempFrom,
            tempTo: dto.tempTo,
            paymentTermDays: dto.paymentTermDays,
            status: dto.status,
            note: dto.note,
            ...(dto.salesOwnerEmpId && {
                salesOwnerEmp: { connect: { id: dto.salesOwnerEmpId } },
            }),
            ...(dto.accountingOwnerEmpId && {
                accountingOwnerEmp: { connect: { id: dto.accountingOwnerEmpId } },
            }),
            ...(dto.legalOwnerEmpId && {
                legalOwnerEmp: { connect: { id: dto.legalOwnerEmpId } },
            }),
        }

        const created = await this.prisma.customer.create({ data })
        return created
    }

    // Detail
    async detail(id: string) {
        const customer = await this.prisma.customer.findFirst({
            where: { id, deletedAt: null },
        })
        if (!customer) throw new NotFoundException('Không tìm thấy khách hàng')
        return customer
    }

    // Update
    async update(id: string, dto: UpdateCustomerDto) {
        const existing = await this.prisma.customer.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy khách hàng')

        const data: Prisma.CustomerUpdateInput = {
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            roles: dto.roles,
            type: dto.type,
            billingAddress: dto.billingAddress,
            shippingAddress: dto.shippingAddress,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            creditLimit: dto.creditLimit ?? undefined,
            tempLimit: dto.tempLimit ?? undefined,
            tempFrom: dto.tempFrom,
            tempTo: dto.tempTo,
            paymentTermDays: dto.paymentTermDays,
            status: dto.status,
            note: dto.note,
            ...(dto.salesOwnerEmpId && {
                salesOwnerEmp: { connect: { id: dto.salesOwnerEmpId } },
            }),
            ...(dto.accountingOwnerEmpId && {
                accountingOwnerEmp: { connect: { id: dto.accountingOwnerEmpId } },
            }),
            ...(dto.legalOwnerEmpId && {
                legalOwnerEmp: { connect: { id: dto.legalOwnerEmpId } },
            }),
        }

        const updated = await this.prisma.customer.update({
            where: { id },
            data,
        })

        return updated
    }

    // Soft delete
    async remove(id: string) {
        const existing = await this.prisma.customer.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy khách hàng')

        const updated = await this.prisma.customer.update({
            where: { id },
            data: { deletedAt: new Date() },
        })

        return updated
    }

    async overview(id: string) {
        const customer = await this.prisma.customer.findUnique({
            where: { id },
            select: {
                id: true,
                code: true,
                name: true,
                taxCode: true,
                type: true,
                creditLimit: true,
                note: true,
                salesOwnerEmp: { select: { fullName: true } },
                accountingOwnerEmp: { select: { fullName: true } },
                legalOwnerEmp: { select: { fullName: true } },
            },
        })

        if (!customer) {
            throw new NotFoundException('Customer not found')
        }

        const contracts = await this.prisma.contract.findMany({
            where: {
                customerId: id,
                deletedAt: null,
            },
            select: {
                id: true,
                code: true,
                name: true,
                startDate: true,
                endDate: true,
                status: true,
                paymentTermDays: true,
                creditLimitOverride: true,
                riskLevel: true,
                renewalOfId: true,
            },
            orderBy: {
                startDate: 'desc',
            },
        })

        return {
            id: customer.id,
            code: customer.code,
            name: customer.name,
            taxCode: customer.taxCode,
            type: customer.type,
            creditLimit: customer.creditLimit,
            note: customer.note,
            salesOwnerName: customer.salesOwnerEmp?.fullName ?? null,
            accountingOwnerName: customer.accountingOwnerEmp?.fullName ?? null,
            legalOwnerName: customer.legalOwnerEmp?.fullName ?? null,
            contracts,
        }
    }
}
