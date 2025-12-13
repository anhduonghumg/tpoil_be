// prisma/seed.ts
import { PrismaClient, ScopeType } from '@prisma/client'
import * as bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
    // ===== 1. Seed user admin =====
    const hash = await bcrypt.hash('admin@tpoil', 12)

    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@tpoil.com' },
        update: {
            // nếu muốn update thêm name hay isActive có thể set ở đây
            name: 'Admin',
            isActive: true,
        },
        create: {
            username: 'admin',
            email: 'admin@tpoil.com',
            password: hash,
            name: 'Admin',
            isActive: true,
        },
    })

    console.log('✅ Seed user admin xong:', adminUser.email)

    // ===== 2. Seed Modules =====
    const modulesData = [
        { code: 'contracts', name: 'Hợp đồng' },
        { code: 'customers', name: 'Khách hàng' },
        { code: 'employees', name: 'Nhân viên' },
        { code: 'system', name: 'Hệ thống' }, // 👈 thêm module System
    ]

    for (const m of modulesData) {
        await prisma.module.upsert({
            where: { code: m.code },
            update: { name: m.name },
            create: m,
        })
    }

    const modules = await prisma.module.findMany()
    const moduleMap = new Map(modules.map((m) => [m.code, m]))
    console.log(
        '✅ Seed modules xong:',
        modules.map((m) => m.code),
    )

    // ===== 3. Seed Permissions =====
    const permissionsData = [
        // Contracts
        { moduleCode: 'contracts', code: 'contracts.view', name: 'Xem hợp đồng' },
        { moduleCode: 'contracts', code: 'contracts.create', name: 'Tạo hợp đồng' },
        { moduleCode: 'contracts', code: 'contracts.update', name: 'Sửa hợp đồng' },
        { moduleCode: 'contracts', code: 'contracts.delete', name: 'Xoá hợp đồng' },
        { moduleCode: 'contracts', code: 'contracts.import', name: 'Import hợp đồng từ Excel' },

        // Customers
        { moduleCode: 'customers', code: 'customers.view', name: 'Xem khách hàng' },
        { moduleCode: 'customers', code: 'customers.create', name: 'Tạo khách hàng' },
        { moduleCode: 'customers', code: 'customers.update', name: 'Sửa khách hàng' },
        { moduleCode: 'customers', code: 'customers.delete', name: 'Xoá khách hàng' },

        // Employees (chuẩn bị cho User/Employee module)
        { moduleCode: 'employees', code: 'employees.view', name: 'Xem nhân viên' },
        { moduleCode: 'employees', code: 'employees.create', name: 'Tạo nhân viên' },
        { moduleCode: 'employees', code: 'employees.update', name: 'Sửa nhân viên' },
        { moduleCode: 'employees', code: 'employees.delete', name: 'Xoá nhân viên' },

        // System (RBAC admin, v.v.)
        {
            moduleCode: 'system',
            code: 'system.rbac.admin',
            name: 'Quản trị phân quyền (RBAC)',
        },
    ]

    for (const p of permissionsData) {
        const module = moduleMap.get(p.moduleCode)
        if (!module) {
            console.warn(`⚠️ Không tìm thấy module ${p.moduleCode} để seed permission ${p.code}`)
            continue
        }

        await prisma.permission.upsert({
            where: { code: p.code },
            update: {
                name: p.name,
                moduleId: module.id,
            },
            create: {
                code: p.code,
                name: p.name,
                moduleId: module.id,
            },
        })
    }

    const allPermissions = await prisma.permission.findMany()
    console.log(
        '✅ Seed permissions xong:',
        allPermissions.map((p) => p.code),
    )

    // ===== 4. Seed Role "system-admin" (full quyền) =====
    const adminRole = await prisma.role.upsert({
        where: { code: 'system-admin' },
        update: {
            name: 'Quản trị hệ thống',
            desc: 'Full quyền toàn hệ thống',
        },
        create: {
            code: 'system-admin',
            name: 'Quản trị hệ thống',
            desc: 'Full quyền toàn hệ thống',
        },
    })

    console.log('✅ Seed role system-admin xong')

    // Gán toàn bộ permission cho system-admin (bao gồm system.rbac.admin)
    await prisma.rolePermission.createMany({
        data: allPermissions.map((p) => ({
            roleId: adminRole.id,
            permissionId: p.id,
        })),
        skipDuplicates: true,
    })

    console.log('✅ Gán tất cả permissions cho system-admin xong')

    // ===== 5. Gán binding system-admin (global) cho admin user =====
    const existingBinding = await prisma.userRoleBinding.findFirst({
        where: {
            userId: adminUser.id,
            roleId: adminRole.id,
            scopeType: ScopeType.global,
            scopeId: null,
        },
    })

    if (!existingBinding) {
        await prisma.userRoleBinding.create({
            data: {
                userId: adminUser.id,
                roleId: adminRole.id,
                scopeType: ScopeType.global,
                scopeId: null,
                createdBy: adminUser.id,
            },
        })
        console.log('✅ Gán role system-admin (global) cho admin@tpoil.com xong')
    } else {
        console.log('ℹ️ admin@tpoil.com đã có binding system-admin (global), bỏ qua')
    }

    console.log('🎉 Seed RBAC + admin hoàn tất!')
}

main()
    .catch((e) => {
        console.error('❌ Seed lỗi:', e)
        process.exit(1)
    })
    .finally(() => prisma.$disconnect())
