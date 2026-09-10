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
import {
    MERCHANT_DERIVED_ROLES,
    MerchantRole,
    PartyMerchantService,
} from './party-merchant.service'
import {
    CreatePartyBankAccountDto,
    PartyBankAccountInputDto,
    UpdatePartyBankAccountDto,
} from './dto/party-bank-account.dto'

/** Một dòng tài khoản ngân hàng đã được chuẩn hóa, sẵn sàng ghi xuống DB. */
type NormalizedBankAccount = {
    id?: string
    bankName: string
    bankCode: string | null
    accountNo: string
    accountName: string
    isDefault: boolean
    isActive: boolean
}

@Injectable()
export class CustomersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly merchants: PartyMerchantService,
    ) {}

    private readonly shipPartnerRoles = new Set<PartyRoleType>([
        PartyRoleType.SHIP_OWNER,
        PartyRoleType.SEA_CARRIER,
    ])

    private readonly businessRoles = new Set<PartyRoleType>([
        PartyRoleType.CUSTOMER,
        PartyRoleType.SUPPLIER,
        PartyRoleType.INTERNAL_COMPANY,
    ])

    private readonly merchantRoles = new Set<PartyRoleType>([
        PartyRoleType.TNPP,
        PartyRoleType.TNDM,
        PartyRoleType.TNDL,
    ])

    private toPartyRole(role: PartyRoleType): PartyRoleType {
        return role
    }

    private toOperationalRole(role: PartyRoleType): OperationalPartyRole | null {
        if (
            this.businessRoles.has(role) ||
            this.merchantRoles.has(role) ||
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
            /** Loại thương nhân đang áp dụng; null = đối tác dịch vụ. */
            merchantRole:
                ([PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] as PartyRoleType[]).find(
                    (role) => roleSet.has(role),
                ) ?? null,
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

    /** Ngày loại thương nhân bắt đầu có hiệu lực; bỏ trống thì tính từ hôm nay. */
    private merchantEffectiveFrom(value?: string): Date {
        if (!value) return new Date()
        const day = new Date(value)
        if (Number.isNaN(day.getTime())) {
            throw new BadRequestException('Ngày áp dụng loại thương nhân không hợp lệ.')
        }
        return day
    }

    /**
     * Chuẩn hóa danh sách tài khoản ngân hàng: bỏ dòng trắng, chặn trùng số tài khoản,
     * và giữ đúng MỘT tài khoản mặc định — đề nghị thanh toán lấy tài khoản mặc định ra
     * điền sẵn nên hai dòng cùng đánh dấu sẽ cho kết quả tùy thứ tự đọc.
     */
    private normalizeBankAccounts(input?: PartyBankAccountInputDto[]): NormalizedBankAccount[] {
        const rows: NormalizedBankAccount[] = (input ?? [])
            .map((item) => ({
                id: item.id,
                bankName: String(item.bankName ?? '').trim(),
                bankCode: this.normalizeNullableText(item.bankCode),
                accountNo: String(item.accountNo ?? '').trim(),
                accountName: String(item.accountName ?? '').trim(),
                isDefault: item.isDefault ?? false,
                isActive: item.isActive ?? true,
            }))
            .filter((item) => item.accountNo && item.bankName)

        const seen = new Set<string>()
        for (const row of rows) {
            if (seen.has(row.accountNo)) {
                throw new BadRequestException(`Số tài khoản ${row.accountNo} bị khai trùng.`)
            }
            seen.add(row.accountNo)
            if (!row.accountName) row.accountName = row.bankName
        }

        const active = rows.filter((row) => row.isActive)
        const chosen = active.find((row) => row.isDefault) ?? active[0]
        for (const row of rows) row.isDefault = row === chosen
        return rows
    }

    /**
     * Đề nghị thanh toán trỏ vào tài khoản (onDelete: SetNull), nên xóa thẳng sẽ làm
     * chứng từ cũ mất thông tin thụ hưởng. Chỉ xóa khi chưa ai tham chiếu, còn lại
     * ngừng hoạt động để không xuất hiện trong ô chọn nữa.
     */
    private async retireBankAccount(tx: Prisma.TransactionClient, id: string) {
        const referenced = await tx.purchaseTermPaymentRequest.count({
            where: { beneficiaryBankAccountId: id },
        })
        if (referenced > 0) {
            await tx.partyBankAccount.update({
                where: { id },
                data: { isActive: false, isDefault: false },
            })
            return false
        }
        await tx.partyBankAccount.delete({ where: { id } })
        return true
    }

    /** Đồng bộ toàn bộ danh sách tài khoản của một đối tác theo đúng những gì form gửi lên. */
    private async syncBankAccounts(
        tx: Prisma.TransactionClient,
        partyId: string,
        rows: NormalizedBankAccount[],
    ) {
        const current = await tx.partyBankAccount.findMany({
            where: { partyId },
            select: { id: true, accountNo: true },
        })
        const keep = new Set(rows.map((row) => row.id).filter((id): id is string => Boolean(id)))

        // Gỡ trước rồi mới ghi, để số tài khoản vừa bỏ không chặn dòng mới trùng số.
        for (const existing of current) {
            if (keep.has(existing.id)) continue
            await this.retireBankAccount(tx, existing.id)
        }

        const remaining = await tx.partyBankAccount.findMany({
            where: { partyId },
            select: { id: true, accountNo: true },
        })
        for (const row of rows) {
            const { id, ...data } = row
            const target =
                (id && remaining.find((item) => item.id === id)) ||
                // Tài khoản cũ chỉ bị ngừng hoạt động vẫn giữ chỗ số tài khoản (unique
                // theo partyId+accountNo), nên khai lại chính số đó là dùng lại dòng cũ.
                remaining.find((item) => item.accountNo === data.accountNo)
            if (target) {
                await tx.partyBankAccount.update({ where: { id: target.id }, data })
            } else {
                await tx.partyBankAccount.create({ data: { partyId, ...data } })
            }
        }
    }

    /**
     * Đồng bộ vai trò đối tác. `preserve` là các vai trò do trục thương nhân quản lý
     * (loại thương nhân và CUSTOMER/SUPPLIER suy ra từ nó): chúng có ngày hiệu lực
     * riêng nên PartyMerchantService đóng/mở kỳ, ở đây chỉ được để yên.
     */
    private async syncPartyRoles(
        tx: Prisma.TransactionClient,
        partyId: string,
        roles: PartyRoleType[],
        preserve: PartyRoleType[] = [],
    ) {
        const preserved = new Set(preserve)
        const uniqueRoles = [...new Set(roles)].filter((role) => !preserved.has(role))
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
        const untouchable = [...new Set([...uniqueRoles, ...preserved])]
        await tx.partyRole.updateMany({
            where: {
                partyId,
                validTo: null,
                ...(untouchable.length ? { role: { notIn: untouchable } } : {}),
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
        const effectiveAt = query.effectiveAt ? new Date(`${query.effectiveAt}T00:00:00`) : new Date()

        const where: Prisma.PartyWhereInput = { deletedAt: null }

        // Lọc theo chiều giao dịch xăng dầu: chỉ hiện đối tác đặt được chứng từ.
        if (role === CustomerSelectRole.PARTNER) {
            where.roles = {
                some: {
                    role: { in: [PartyRoleType.CUSTOMER, PartyRoleType.SUPPLIER] },
                    validTo: null,
                },
            }
        } else if (role === CustomerSelectRole.SELLABLE || role === CustomerSelectRole.PURCHASABLE) {
            Object.assign(
                where,
                this.merchants.tradableWhere(
                    role === CustomerSelectRole.SELLABLE ? 'SELL' : 'BUY',
                    effectiveAt,
                ),
            )
        } else {
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
                select: {
                    id: true,
                    code: true,
                    name: true,
                    taxCode: true,
                    roles: {
                        where: {
                            role: { in: [PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] },
                            validFrom: { lte: effectiveAt },
                            OR: [{ validTo: null }, { validTo: { gte: effectiveAt } }],
                        },
                        select: { role: true },
                        orderBy: { validFrom: 'desc' },
                        take: 1,
                    },
                },
            }),
            this.prisma.party.count({ where }),
        ])

        return {
            items: items.map(({ roles, ...item }) => ({
                ...item,
                merchantRole: roles[0]?.role ?? null,
            })),
            total,
            page,
            pageSize,
        }
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
        // Chọn loại thương nhân là đủ — CUSTOMER/SUPPLIER suy ra từ đó, khỏi tick tay.
        // Trục thương nhân do PartyMerchantService mở kỳ vì nó cần ngày hiệu lực riêng.
        const merchantRole = (dto.merchantRole ?? null) as MerchantRole | null
        const merchantManaged: PartyRoleType[] = merchantRole
            ? [merchantRole, ...MERCHANT_DERIVED_ROLES[merchantRole]]
            : []
        const bankAccounts = this.normalizeBankAccounts(dto.bankAccounts)

        const assignedRoles: PartyRoleType[] = [
            ...new Set([
                ...(isCustomer && !merchantRole ? [PartyRoleType.CUSTOMER] : []),
                ...(isSupplier && !merchantRole ? [PartyRoleType.SUPPLIER] : []),
                ...(isInternal ? [PartyRoleType.INTERNAL_COMPANY] : []),
                ...partnerRoles.map((role) => this.toPartyRole(role)),
            ]),
        ]

        if (!merchantRole && !assignedRoles.length) {
            throw new BadRequestException('Phải chọn ít nhất một vai trò đối tác.')
        }

        const data: Prisma.PartyCreateInput = {
            code,
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified ?? false,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,
            ...(dto.groupId && { group: { connect: { id: dto.groupId } } }),
            ...(dto.documentOwnerEmpId && { documentOwnerEmp: { connect: { id: dto.documentOwnerEmpId } } }),
            billingAddress: dto.billingAddress,
            shippingAddress: dto.shippingAddress,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            // Bản sao của tài khoản mặc định, giữ lại cho các báo cáo và bản in cũ vẫn
            // đang đọc cột này. Nguồn thật là bảng PartyBankAccount.
            bankAccountNo: bankAccounts.find((item) => item.isDefault)?.accountNo ?? null,
            // creditLimit / paymentTermDays cố ý không nhận ở đây: màn Quản lý công nợ
            // mới được ghi chúng, vì nó có kiểm quyền, bắt lý do và ghi CreditLimitHistory.
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
            // Trục thương nhân mở kỳ trước, syncPartyRoles để yên các vai trò nó vừa mở.
            if (merchantRole) {
                await this.merchants.setMerchantRole(
                    created.id,
                    merchantRole,
                    this.merchantEffectiveFrom(dto.merchantEffectiveFrom),
                    tx,
                )
            }
            await this.syncPartyRoles(tx, created.id, assignedRoles, merchantManaged)
            if (bankAccounts.length) {
                await tx.partyBankAccount.createMany({
                    data: bankAccounts.map(({ id: _id, ...row }) => ({ partyId: created.id, ...row })),
                })
            }
            const roles = await tx.partyRole.findMany({
                where: { partyId: created.id, validTo: null },
                select: { role: true },
            })
            return this.apiParty({ ...created, roles })
        })
    }

    // Detail
    async detail(id: string) {
        const customer = await this.prisma.party.findFirst({
            where: { id, deletedAt: null },
            include: {
                roles: { where: { validTo: null }, select: { role: true } },
                bankAccounts: { orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { createdAt: 'asc' }] },
            },
        })
        if (!customer) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng')
        // Lịch sử loại thương nhân đi kèm hồ sơ: người dùng cần thấy kỳ nào áp dụng từ
        // khi nào trước khi đổi sang loại mới.
        const merchantHistory = await this.merchants.merchantHistory(id)
        return { ...this.apiParty(customer), merchantHistory }
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
        const currentMerchantRole = ([PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] as MerchantRole[]).find(
            (role) => activeRoleSet.has(role),
        ) ?? null
        const merchantRole = dto.merchantRole !== undefined ? (dto.merchantRole as MerchantRole | null) : currentMerchantRole
        const merchantChanged = merchantRole !== currentMerchantRole
        // Không gửi mảng = không đụng tới tài khoản ngân hàng; gửi mảng rỗng = xóa hết.
        const bankAccounts = dto.bankAccounts ? this.normalizeBankAccounts(dto.bankAccounts) : null

        /**
         * Vai trò do trục thương nhân quản SAU thay đổi: loại thương nhân mới và
         * CUSTOMER/SUPPLIER nó suy ra. syncPartyRoles phải để yên chúng vì kỳ hiệu lực
         * của chúng do PartyMerchantService đóng/mở theo ngày người dùng chọn.
         *
         * Tính theo loại MỚI chứ không phải loại cũ: khi người dùng bỏ loại thương nhân,
         * CUSTOMER/SUPPLIER quay về do các tick thủ công quyết định.
         */
        const merchantManaged: PartyRoleType[] = merchantRole
            ? [merchantRole, ...MERCHANT_DERIVED_ROLES[merchantRole]]
            : []

        const assignedRoles: PartyRoleType[] = [
            ...(nextIsCustomer && !merchantRole ? [PartyRoleType.CUSTOMER] : []),
            ...(nextIsSupplier && !merchantRole ? [PartyRoleType.SUPPLIER] : []),
            ...(nextIsInternal ? [PartyRoleType.INTERNAL_COMPANY] : []),
            ...nextPartnerRoles.map((role) => this.toPartyRole(role)),
        ]

        if (!merchantRole && !nextIsCustomer && !nextIsSupplier && !nextIsInternal && nextPartnerRoles.length === 0) {
            throw new BadRequestException('Pháº£i chá»n Ã­t nháº¥t má»™t vai trÃ² Ä‘á»‘i tÃ¡c.')
        }

        const data: Prisma.PartyUpdateInput = {
            name: dto.name,
            taxCode: dto.taxCode,
            taxVerified: dto.taxVerified,
            taxSource: dto.taxSource,
            taxSyncedAt: dto.taxSyncedAt,

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
            // Bản sao của tài khoản mặc định cho các báo cáo cũ; chỉ đụng tới khi form
            // thực sự gửi danh sách tài khoản lên.
            ...(bankAccounts
                ? { bankAccountNo: bankAccounts.find((item) => item.isDefault)?.accountNo ?? null }
                : {}),
            // creditLimit / paymentTermDays cố ý không nhận ở đây: màn Quản lý công nợ
            // mới được ghi chúng, vì nó có kiểm quyền, bắt lý do và ghi CreditLimitHistory.
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
            // Trục thương nhân chạy TRƯỚC: đổi loại là mở một kỳ mới chứ không ghi đè, kỳ
            // cũ được đóng ngay trước ngày hiệu lực để chứng từ cũ vẫn tra ra đúng loại
            // của nó. Xong rồi syncPartyRoles mới xử lý phần vai trò còn lại, dựa trên
            // trạng thái đã chốt.
            if (merchantChanged) {
                await this.merchants.setMerchantRole(
                    id,
                    merchantRole,
                    this.merchantEffectiveFrom(dto.merchantEffectiveFrom),
                    tx,
                )
            }
            await this.syncPartyRoles(tx, id, assignedRoles, merchantManaged)
            if (bankAccounts) await this.syncBankAccounts(tx, id, bankAccounts)
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

    // ---- Tài khoản ngân hàng của đối tác ----

    private async assertPartyExists(partyId: string) {
        const party = await this.prisma.party.findFirst({
            where: { id: partyId, deletedAt: null },
            select: { id: true },
        })
        if (!party) throw new NotFoundException('Không tìm thấy đối tác')
    }

    /** Số tài khoản mặc định được nhân bản sang Party.bankAccountNo cho các báo cáo cũ đọc. */
    private async refreshLegacyBankAccountNo(tx: Prisma.TransactionClient, partyId: string) {
        const preferred = await tx.partyBankAccount.findFirst({
            where: { partyId, isActive: true },
            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
            select: { accountNo: true },
        })
        await tx.party.update({
            where: { id: partyId },
            data: { bankAccountNo: preferred?.accountNo ?? null },
        })
    }

    /** Chỉ một tài khoản được làm mặc định cho mỗi đối tác. */
    private async clearOtherDefaults(tx: Prisma.TransactionClient, partyId: string, keepId: string) {
        await tx.partyBankAccount.updateMany({
            where: { partyId, isDefault: true, id: { not: keepId } },
            data: { isDefault: false },
        })
    }

    async listBankAccounts(partyId: string) {
        await this.assertPartyExists(partyId)
        return this.prisma.partyBankAccount.findMany({
            where: { partyId },
            orderBy: [{ isActive: 'desc' }, { isDefault: 'desc' }, { createdAt: 'asc' }],
        })
    }

    async createBankAccount(partyId: string, dto: CreatePartyBankAccountDto) {
        await this.assertPartyExists(partyId)
        const [row] = this.normalizeBankAccounts([dto])
        if (!row) throw new BadRequestException('Thiếu tên ngân hàng hoặc số tài khoản.')

        return this.prisma.$transaction(async (tx) => {
            const duplicate = await tx.partyBankAccount.findFirst({
                where: { partyId, accountNo: row.accountNo },
                select: { id: true },
            })
            if (duplicate) {
                throw new BadRequestException(`Số tài khoản ${row.accountNo} đã có trong hồ sơ.`)
            }
            // Tài khoản đầu tiên mặc nhiên là mặc định, nếu không đề nghị thanh toán sẽ
            // không có gì để điền sẵn.
            const existingCount = await tx.partyBankAccount.count({ where: { partyId, isActive: true } })
            const { id: _id, ...data } = row
            const created = await tx.partyBankAccount.create({
                data: { partyId, ...data, isDefault: data.isDefault || existingCount === 0 },
            })
            if (created.isDefault) await this.clearOtherDefaults(tx, partyId, created.id)
            await this.refreshLegacyBankAccountNo(tx, partyId)
            return created
        })
    }

    async updateBankAccount(partyId: string, accountId: string, dto: UpdatePartyBankAccountDto) {
        const existing = await this.prisma.partyBankAccount.findFirst({
            where: { id: accountId, partyId },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy tài khoản ngân hàng')

        const accountNo = dto.accountNo?.trim()
        return this.prisma.$transaction(async (tx) => {
            if (accountNo && accountNo !== existing.accountNo) {
                const duplicate = await tx.partyBankAccount.findFirst({
                    where: { partyId, accountNo, id: { not: accountId } },
                    select: { id: true },
                })
                if (duplicate) {
                    throw new BadRequestException(`Số tài khoản ${accountNo} đã có trong hồ sơ.`)
                }
            }
            const updated = await tx.partyBankAccount.update({
                where: { id: accountId },
                data: {
                    bankName: dto.bankName?.trim(),
                    bankCode: dto.bankCode === undefined ? undefined : this.normalizeNullableText(dto.bankCode),
                    accountNo,
                    accountName: dto.accountName?.trim(),
                    isActive: dto.isActive,
                    // Tài khoản ngừng hoạt động không thể là mặc định.
                    isDefault: dto.isActive === false ? false : dto.isDefault,
                },
            })
            if (updated.isDefault) await this.clearOtherDefaults(tx, partyId, updated.id)
            await this.refreshLegacyBankAccountNo(tx, partyId)
            return updated
        })
    }

    async removeBankAccount(partyId: string, accountId: string) {
        const existing = await this.prisma.partyBankAccount.findFirst({
            where: { id: accountId, partyId },
            select: { id: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy tài khoản ngân hàng')

        return this.prisma.$transaction(async (tx) => {
            const deleted = await this.retireBankAccount(tx, accountId)
            await this.refreshLegacyBankAccountNo(tx, partyId)
            return {
                deleted,
                message: deleted
                    ? 'Đã xóa tài khoản ngân hàng.'
                    : 'Tài khoản đã gắn với đề nghị thanh toán nên chỉ được ngừng sử dụng, không xóa.',
            }
        })
    }
}
