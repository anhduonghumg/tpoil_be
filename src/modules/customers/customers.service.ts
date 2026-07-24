import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { CustomerListQueryDto } from './dto/customer-list-query.dto'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { OperationalPartyRole, PartyRoleType, Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import dayjs from 'dayjs'
import { CustomerSelectQueryDto } from './dto/customer-select-query.dto'
import { CustomerListRole } from './dto/customer-list-query.dto'
import { CustomerSelectRole } from './dto/customer-select-query.dto'
import { UpdateCustomerPurchaseDefaultsDto } from './dto/update-customer-purchase-defaults.dto'

@Injectable()
export class CustomersService {
    constructor(private readonly prisma: PrismaService) {}

    private readonly shipPartnerRoles = new Set<PartyRoleType>([
        PartyRoleType.SHIP_OWNER,
        PartyRoleType.SEA_CARRIER,
    ])

    private readonly businessRoles = new Set<PartyRoleType>([
        PartyRoleType.CUSTOMER,
        PartyRoleType.SUPPLIER,
        PartyRoleType.INTERNAL_COMPANY,
    ])

    private toPartyRole(role: OperationalPartyRole): PartyRoleType {
        return role === OperationalPartyRole.STORAGE_LESSOR
            ? PartyRoleType.STORAGE_LESSOR
            : (role as unknown as PartyRoleType)
    }

    private toOperationalRole(role: PartyRoleType): OperationalPartyRole | null {
        if (
            this.businessRoles.has(role) ||
            role === PartyRoleType.INVENTORY_OWNER ||
            role === PartyRoleType.WAREHOUSE_OPERATOR ||
            role === PartyRoleType.WAREHOUSE_LESSOR
        ) {
            return null
        }
        return role === PartyRoleType.STORAGE_LESSOR
            ? OperationalPartyRole.STORAGE_LESSOR
            : (role as unknown as OperationalPartyRole)
    }

    private apiParty<T extends { roles: Array<{ role: PartyRoleType }>; customerRoles: unknown }>(party: T) {
        const { roles, customerRoles, ...data } = party
        const roleSet = new Set(roles.map((item) => item.role))
        return {
            ...data,
            roles: customerRoles,
            isCustomer: roleSet.has(PartyRoleType.CUSTOMER),
            isSupplier: roleSet.has(PartyRoleType.SUPPLIER),
            isInternal: roleSet.has(PartyRoleType.INTERNAL_COMPANY),
            partyType: roleSet.has(PartyRoleType.INTERNAL_COMPANY)
                ? 'INTERNAL'
                : roleSet.has(PartyRoleType.SUPPLIER)
                  ? 'SUPPLIER'
                  : 'CUSTOMER',
            partnerRoles: roles
                .map((item) => this.toOperationalRole(item.role))
                .filter((role): role is OperationalPartyRole => role != null),
        }
    }

    private normalizeNullableText(value?: string | null): string | null {
        const s = String(value ?? '').trim()
        return s ? s : null
    }

    private async syncPartyRoles(tx: Prisma.TransactionClient, partyId: string, roles: PartyRoleType[]) {
        const uniqueRoles = [...new Set(roles)]
        const currentRoles = await tx.partyRole.findMany({
            where: { partyId, validTo: null },
            select: { id: true, role: true },
        })
        const hadShipRole = currentRoles.some((item) => this.shipPartnerRoles.has(item.role))
        const keepsShipRole = uniqueRoles.some((role) => this.shipPartnerRoles.has(role))

        if (hadShipRole && !keepsShipRole) {
            const activeVesselCount = await tx.vessel.count({ where: { ownerCustomerId: partyId, isActive: true } })
            if (activeVesselCount > 0) {
                throw new BadRequestException('KhÃ´ng thá»ƒ bá» vai trÃ² chá»§ tÃ u khi Ä‘á»‘i tÃ¡c váº«n cÃ²n tÃ u Ä‘ang hoáº¡t Ä‘á»™ng.')
            }
        }

        const now = new Date()
        await tx.partyRole.updateMany({
            where: {
                partyId,
                validTo: null,
                ...(uniqueRoles.length ? { role: { notIn: uniqueRoles } } : {}),
            },
            data: { validTo: now },
        })
        for (const role of uniqueRoles) {
            if (currentRoles.some((item) => item.role === role)) continue
            await tx.partyRole.create({ data: { partyId, role, validFrom: now } })
        }
    }

    async list(query: CustomerListQueryDto) {
        const { keyword, role, partyType, type, status, salesOwnerEmpId, accountingOwnerEmpId, documentOwnerEmpId, page = 1, pageSize = 20 } = query

        const requestedRole = role
            ? role === CustomerListRole.INTERNAL
                ? PartyRoleType.INTERNAL_COMPANY
                : (role as unknown as PartyRoleType)
            : partyType
              ? partyType === 'INTERNAL'
                  ? PartyRoleType.INTERNAL_COMPANY
                  : (partyType as unknown as PartyRoleType)
              : null
        const whereRole: Prisma.PartyWhereInput = requestedRole
            ? { roles: { some: { role: requestedRole, validTo: null } } }
            : {}

        const where: Prisma.PartyWhereInput = {
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
            ...(type ? { type } : {}),
            ...(status ? { status } : {}),
            ...(salesOwnerEmpId ? { salesOwnerEmpId } : {}),
            ...(accountingOwnerEmpId ? { accountingOwnerEmpId } : {}),
            ...(documentOwnerEmpId ? { documentOwnerEmpId } : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.party.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    salesOwnerEmp: { select: { fullName: true } },
                    accountingOwnerEmp: { select: { fullName: true } },
                    documentOwnerEmp: { select: { fullName: true } },
                    roles: { where: { validTo: null }, select: { role: true } },
                },
            }),
            this.prisma.party.count({ where }),
        ])

        const mapped = items.map((it) => ({
            ...this.apiParty(it),
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

        const where: Prisma.PartyWhereInput = { deletedAt: null }
        const requestedRole = role
            ? role === CustomerSelectRole.INTERNAL
                ? PartyRoleType.INTERNAL_COMPANY
                : (role as unknown as PartyRoleType)
            : partyType
              ? partyType === 'INTERNAL'
                  ? PartyRoleType.INTERNAL_COMPANY
                  : (partyType as unknown as PartyRoleType)
              : null
        if (requestedRole === PartyRoleType.SHIP_OWNER) {
            where.roles = {
                some: { role: { in: [PartyRoleType.SHIP_OWNER, PartyRoleType.SEA_CARRIER] }, validTo: null },
            }
        } else if (requestedRole) {
            where.roles = { some: { role: requestedRole, validTo: null } }
        }

        if (keyword) {
            where.OR = [
                { code: { contains: keyword, mode: 'insensitive' } },
                { name: { contains: keyword, mode: 'insensitive' } },
                { taxCode: { contains: keyword, mode: 'insensitive' } },
            ]
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.party.findMany({
                where,
                orderBy: { name: 'asc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: { id: true, code: true, name: true, taxCode: true },
            }),
            this.prisma.party.count({ where }),
        ])

        return { items, total, page, pageSize }
    }

    async generateCode() {
        const now = dayjs()
        const prefix = `C${now.format('YYYYMM')}`

        const last = await this.prisma.party.findFirst({
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

        // Náº¿u FE khÃ´ng gá»­i code hoáº·c gá»­i rá»—ng â†’ BE tá»± gen
        if (!code || !code.trim()) {
            const gen = await this.generateCode()
            code = gen.code
        }

        const inferred = dto.partyType ?? 'CUSTOMER'

        const isCustomer = dto.isCustomer ?? inferred === 'CUSTOMER'
        const isSupplier = dto.isSupplier ?? inferred === 'SUPPLIER'
        const isInternal = dto.isInternal ?? inferred === 'INTERNAL'
        const partnerRoles = [...new Set(dto.partnerRoles ?? [])]
        const assignedRoles: PartyRoleType[] = [
            ...(isCustomer ? [PartyRoleType.CUSTOMER] : []),
            ...(isSupplier ? [PartyRoleType.SUPPLIER] : []),
            ...(isInternal ? [PartyRoleType.INTERNAL_COMPANY] : []),
            ...partnerRoles.map((role) => this.toPartyRole(role)),
        ]

        if (!assignedRoles.length) {
            throw new BadRequestException('Pháº£i chá»n Ã­t nháº¥t má»™t vai trÃ² Ä‘á»‘i tÃ¡c.')
        }

        const data: Prisma.PartyCreateInput = {
            code,
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified ?? false,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            customerRoles: dto.roles,
            type: dto.type,
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

        return this.prisma.$transaction(async (tx) => {
            const created = await tx.party.create({ data })
            await this.syncPartyRoles(tx, created.id, assignedRoles)
            return this.apiParty({ ...created, roles: assignedRoles.map((role) => ({ role })) })
        })
    }

    // Detail
    async detail(id: string) {
        const customer = await this.prisma.party.findFirst({
            where: { id, deletedAt: null },
            include: { roles: { where: { validTo: null }, select: { role: true } } },
        })
        if (!customer) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng')
        return this.apiParty(customer)
    }

    // Update
    async update(id: string, dto: UpdateCustomerDto) {
        const existing = await this.prisma.party.findFirst({
            where: { id, deletedAt: null },
            include: { roles: { where: { validTo: null }, select: { role: true } } },
        })
        if (!existing) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng')

        const activeRoleSet = new Set(existing.roles.map((item) => item.role))
        const inferred =
            dto.partyType ??
            (activeRoleSet.has(PartyRoleType.INTERNAL_COMPANY)
                ? 'INTERNAL'
                : activeRoleSet.has(PartyRoleType.SUPPLIER)
                  ? 'SUPPLIER'
                  : 'CUSTOMER')
        const nextIsCustomer =
            dto.isCustomer ?? (dto.partyType ? inferred === 'CUSTOMER' : activeRoleSet.has(PartyRoleType.CUSTOMER))
        const nextIsSupplier =
            dto.isSupplier ?? (dto.partyType ? inferred === 'SUPPLIER' : activeRoleSet.has(PartyRoleType.SUPPLIER))
        const nextIsInternal =
            dto.isInternal ??
            (dto.partyType ? inferred === 'INTERNAL' : activeRoleSet.has(PartyRoleType.INTERNAL_COMPANY))
        const currentPartnerRoles = existing.roles
            .map((item) => this.toOperationalRole(item.role))
            .filter((role): role is OperationalPartyRole => role != null)
        const nextPartnerRoles = dto.partnerRoles ?? currentPartnerRoles
        const assignedRoles: PartyRoleType[] = [
            ...(nextIsCustomer ? [PartyRoleType.CUSTOMER] : []),
            ...(nextIsSupplier ? [PartyRoleType.SUPPLIER] : []),
            ...(nextIsInternal ? [PartyRoleType.INTERNAL_COMPANY] : []),
            ...nextPartnerRoles.map((role) => this.toPartyRole(role)),
        ]

        if (!nextIsCustomer && !nextIsSupplier && !nextIsInternal && nextPartnerRoles.length === 0) {
            throw new BadRequestException('Pháº£i chá»n Ã­t nháº¥t má»™t vai trÃ² Ä‘á»‘i tÃ¡c.')
        }

        const data: Prisma.PartyUpdateInput = {
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            customerRoles: dto.roles,
            type: dto.type,

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

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.party.update({ where: { id }, data })
            await this.syncPartyRoles(tx, id, assignedRoles)
            const roles = await tx.partyRole.findMany({
                where: { partyId: id, validTo: null },
                select: { role: true },
            })
            return this.apiParty({ ...updated, roles })
        })
    }

    // Soft delete
    async remove(id: string) {
        const existing = await this.prisma.party.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng')

        const updated = await this.prisma.party.update({
            where: { id },
            data: { deletedAt: new Date() },
        })

        return updated
    }

    async overview(id: string) {
        const customer = await this.prisma.party.findUnique({
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

    async getPurchaseDefaults(id: string) {
        const customer = await this.prisma.party.findUnique({
            where: { id },
            select: {
                id: true,
                code: true,
                name: true,
                defaultPurchaseContractNo: true,
                defaultDeliveryLocation: true,
                updatedAt: true,
            },
        })

        if (!customer) {
            throw new NotFoundException('CUSTOMER_NOT_FOUND')
        }

        return {
            id: customer.id,
            code: customer.code,
            name: customer.name,
            defaultPurchaseContractNo: customer?.defaultPurchaseContractNo,
            defaultDeliveryLocation: customer?.defaultDeliveryLocation,
            updatedAt: customer.updatedAt,
        }
    }

    async updatePurchaseDefaults(id: string, dto: UpdateCustomerPurchaseDefaultsDto) {
        const existing = await this.prisma.party.findUnique({
            where: { id },
            select: { id: true },
        })

        if (!existing) {
            throw new NotFoundException('CUSTOMER_NOT_FOUND')
        }

        const updated = await this.prisma.party.update({
            where: { id },
            data: {
                defaultPurchaseContractNo: dto.defaultPurchaseContractNo !== undefined ? this.normalizeNullableText(dto.defaultPurchaseContractNo) : undefined,
                defaultDeliveryLocation: dto.defaultDeliveryLocation !== undefined ? this.normalizeNullableText(dto.defaultDeliveryLocation) : undefined,
            },
            select: {
                id: true,
                code: true,
                name: true,
                defaultPurchaseContractNo: true,
                defaultDeliveryLocation: true,
                updatedAt: true,
            },
        })

        return {
            id: updated.id,
            code: updated.code,
            name: updated.name,
            defaultPurchaseContractNo: updated.defaultPurchaseContractNo,
            defaultDeliveryLocation: updated.defaultDeliveryLocation,
            updatedAt: updated.updatedAt,
        }
    }
}
