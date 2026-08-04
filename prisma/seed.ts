import { PartyRoleType, PrismaClient, ScopeType, WarehousePartyRole } from '@prisma/client'
import * as bcrypt from 'bcrypt'
import { PERMISSIONS } from '../src/common/auth/permissions.constant'
import { seedUsersPermissions } from './02_users_permissions.seed'
import { seedOperationsPermissions } from './03_operations_permissions.seed'
import { seedSalesPermissions } from './04_sales_permissions.seed'

const prisma = new PrismaClient()

const moduleNames: Record<keyof typeof PERMISSIONS, string> = {
    system: 'Hệ thống',
    contracts: 'Hợp đồng',
    customers: 'Khách hàng và nhà cung cấp',
    employees: 'Nhân sự',
    users: 'Tài khoản',
    roles: 'Vai trò và phân quyền',
    departments: 'Phòng ban',
    products: 'Sản phẩm',
    priceBulletins: 'Bảng giá',
    banking: 'Ngân hàng',
    purchases: 'Mua hàng',
    sales: 'Bán hàng',
    operations: 'Vận hành',
}

async function seedPermissionCatalog() {
    for (const [moduleCode, permissions] of Object.entries(PERMISSIONS) as [keyof typeof PERMISSIONS, object][]) {
        const moduleRow = await prisma.module.upsert({
            where: { code: moduleCode },
            update: { name: moduleNames[moduleCode] },
            create: { code: moduleCode, name: moduleNames[moduleCode] },
        })
        for (const code of Object.values(permissions) as string[]) {
            await prisma.permission.upsert({
                where: { code },
                update: { moduleId: moduleRow.id },
                create: { code, name: code, moduleId: moduleRow.id },
            })
        }
    }
}

async function ensurePartyRole(partyId: string, role: PartyRoleType) {
    const current = await prisma.partyRole.findFirst({
        where: { partyId, role, validTo: null },
        select: { id: true },
    })
    if (!current) await prisma.partyRole.create({ data: { partyId, role } })
}

async function main() {
    const adminRole = await prisma.role.upsert({
        where: { code: 'system-admin' },
        update: { name: 'Quản trị hệ thống', desc: 'Toàn quyền hệ thống' },
        create: { code: 'system-admin', name: 'Quản trị hệ thống', desc: 'Toàn quyền hệ thống' },
    })

    await seedPermissionCatalog()
    await seedUsersPermissions(prisma)
    await seedOperationsPermissions(prisma)
    await seedSalesPermissions(prisma)

    const allPermissions = await prisma.permission.findMany({ select: { id: true } })
    await prisma.rolePermission.createMany({
        data: allPermissions.map((permission) => ({
            roleId: adminRole.id,
            permissionId: permission.id,
        })),
        skipDuplicates: true,
    })

    const password = await bcrypt.hash(process.env.SEED_ADMIN_PASSWORD ?? 'admin@tpoil', 12)
    const admin = await prisma.user.upsert({
        where: { email: 'admin@tpoil.com' },
        update: { username: 'admin', password, name: 'Quản trị viên', isActive: true },
        create: {
            username: 'admin',
            email: 'admin@tpoil.com',
            password,
            name: 'Quản trị viên',
            isActive: true,
        },
    })

    const binding = await prisma.userRoleBinding.findFirst({
        where: { userId: admin.id, roleId: adminRole.id, scopeType: ScopeType.global, scopeId: null, endAt: null },
        select: { id: true },
    })
    if (!binding) {
        await prisma.userRoleBinding.create({
            data: {
                userId: admin.id,
                roleId: adminRole.id,
                scopeType: ScopeType.global,
                createdBy: admin.id,
            },
        })
    }

    const internalParty = await prisma.party.upsert({
        where: { code: 'TPOIL' },
        update: { name: 'TPOIL', masterStatus: 'ACTIVE', deletedAt: null },
        create: {
            code: 'TPOIL',
            name: 'TPOIL',
            customerRoles: [],
            masterStatus: 'ACTIVE',
        },
    })
    await ensurePartyRole(internalParty.id, PartyRoleType.INTERNAL_COMPANY)
    await ensurePartyRole(internalParty.id, PartyRoleType.INVENTORY_OWNER)

    const legalEntity = await prisma.legalEntity.upsert({
        where: { code: 'TPOIL' },
        update: { partyId: internalParty.id, baseCurrency: 'VND' },
        create: { code: 'TPOIL', partyId: internalParty.id, baseCurrency: 'VND' },
    })
    const warehouse = await prisma.warehouse.upsert({
        where: { legalEntityId_code: { legalEntityId: legalEntity.id, code: 'MAIN' } },
        update: { name: 'Kho chính TPOIL', status: 'ACTIVE' },
        create: {
            legalEntityId: legalEntity.id,
            code: 'MAIN',
            name: 'Kho chính TPOIL',
            status: 'ACTIVE',
        },
    })
    const assignment = await prisma.warehousePartyAssignment.findFirst({
        where: { warehouseId: warehouse.id, partyId: internalParty.id, role: WarehousePartyRole.OPERATOR, validTo: null },
        select: { id: true },
    })
    if (!assignment) {
        await prisma.warehousePartyAssignment.create({
            data: {
                warehouseId: warehouse.id,
                partyId: internalParty.id,
                role: WarehousePartyRole.OPERATOR,
                validFrom: new Date('2020-01-01T00:00:00.000Z'),
            },
        })
    }

    for (const region of [
        { code: 'VUNG_I', name: 'Vùng I' },
        { code: 'VUNG_II', name: 'Vùng II' },
    ]) {
        await prisma.priceRegion.upsert({
            where: { code: region.code },
            update: { name: region.name, isActive: true },
            create: { ...region, isActive: true },
        })
    }
}

main()
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
    .finally(async () => prisma.$disconnect())
