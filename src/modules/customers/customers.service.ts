import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CustomerListQueryDto } from './dto/customer-list-query.dto'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import dayjs from 'dayjs'
import { CustomerSelectQueryDto } from './dto/customer-select-query.dto'
import { CustomerListRole } from './dto/customer-list-query.dto'
import { CustomerSelectRole } from './dto/customer-select-query.dto'

@Injectable()
export class CustomersService {
    constructor(private readonly prisma: PrismaService) {}
    async list(query: CustomerListQueryDto) {
        const { keyword, role, partyType, type, status, salesOwnerEmpId, accountingOwnerEmpId, documentOwnerEmpId, page = 1, pageSize = 20 } = query

        const whereRole: Prisma.CustomerWhereInput =
            role === CustomerListRole.CUSTOMER
                ? { isCustomer: true }
                : role === CustomerListRole.SUPPLIER
                  ? { isSupplier: true }
                  : role === CustomerListRole.INTERNAL
                    ? { isInternal: true }
                    : {}

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
            ...whereRole,
            ...(!role && partyType ? { partyType } : {}),
            // ...(partyType ? { partyType } : {}),
            ...(type ? { type } : {}),
            ...(status ? { status } : {}),
            ...(salesOwnerEmpId ? { salesOwnerEmpId } : {}),
            ...(accountingOwnerEmpId ? { accountingOwnerEmpId } : {}),
            ...(documentOwnerEmpId ? { documentOwnerEmpId } : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.customer.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    salesOwnerEmp: { select: { fullName: true } },
                    accountingOwnerEmp: { select: { fullName: true } },
                    documentOwnerEmp: { select: { fullName: true } },
                },
            }),
            this.prisma.customer.count({ where }),
        ])

        const mapped = items.map((it) => ({
            ...it,
            salesOwnerName: it.salesOwnerEmp?.fullName ?? null,
            accountingOwnerName: it.accountingOwnerEmp?.fullName ?? null,
            documentOwnerName: it.documentOwnerEmp?.fullName ?? null,
        }))

        return { items: mapped, total, page, pageSize }
    }

    async select(query: CustomerSelectQueryDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 50
        const keyword = query.keyword?.trim()
        const partyType = query.partyType
        const role = query.role

        const where: Prisma.CustomerWhereInput = { deletedAt: null }

        if (role === CustomerSelectRole.CUSTOMER) where.isCustomer = true
        else if (role === CustomerSelectRole.SUPPLIER) where.isSupplier = true
        else if (role === CustomerSelectRole.INTERNAL) where.isInternal = true
        else if (partyType) where.partyType = partyType

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
                orderBy: { name: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: { id: true, code: true, name: true, taxCode: true },
            }),
            this.prisma.customer.count({ where }),
        ])

        return { items, total, page, pageSize }
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

        const inferred = dto.partyType ?? 'CUSTOMER'

        const isCustomer = dto.isCustomer ?? inferred === 'CUSTOMER'
        const isSupplier = dto.isSupplier ?? inferred === 'SUPPLIER'
        const isInternal = dto.isInternal ?? inferred === 'INTERNAL'

        if (!isCustomer && !isSupplier && !isInternal) {
            throw new BadRequestException('Phải chọn ít nhất 1 vai trò (Khách hàng/NCC/Nội bộ).')
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
            partyType: dto.partyType ?? 'CUSTOMER',
            isCustomer,
            isSupplier,
            isInternal,
            ...(dto.groupId && { group: { connect: { id: dto.groupId } } }),
            ...(dto.documentOwnerEmpId && { documentOwnerEmp: { connect: { id: dto.documentOwnerEmpId } } }),
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

        const inferred = dto.partyType ?? existing.partyType ?? 'CUSTOMER'

        const nextIsCustomer = dto.isCustomer ?? (dto.partyType ? inferred === 'CUSTOMER' : (existing.isCustomer ?? false))

        const nextIsSupplier = dto.isSupplier ?? (dto.partyType ? inferred === 'SUPPLIER' : (existing.isSupplier ?? false))

        const nextIsInternal = dto.isInternal ?? (dto.partyType ? inferred === 'INTERNAL' : (existing.isInternal ?? false))

        if (!nextIsCustomer && !nextIsSupplier && !nextIsInternal) {
            throw new BadRequestException('Phải chọn ít nhất 1 vai trò (Khách hàng/NCC/Nội bộ).')
        }

        const data: Prisma.CustomerUpdateInput = {
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            roles: dto.roles,
            type: dto.type,
            partyType: dto.partyType,

            isCustomer: nextIsCustomer,
            isSupplier: nextIsSupplier,
            isInternal: nextIsInternal,

            ...(dto.groupId === null ? { group: { disconnect: true } } : dto.groupId ? { group: { connect: { id: dto.groupId } } } : {}),

            ...(dto.documentOwnerEmpId === null
                ? { documentOwnerEmp: { disconnect: true } }
                : dto.documentOwnerEmpId
                  ? { documentOwnerEmp: { connect: { id: dto.documentOwnerEmpId } } }
                  : {}),
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
