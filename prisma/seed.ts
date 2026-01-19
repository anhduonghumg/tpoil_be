// prisma/seed.ts

import { PrismaClient, ScopeType } from '@prisma/client'
import * as bcrypt from 'bcrypt'

/*
const prisma = new PrismaClient()

async function main() {
    // ===== 1. Seed user admin =====
    const hash = await bcrypt.hash('admin@tpoil', 12)

    const adminUser = await prisma.user.upsert({
        where: { email: 'admin@tpoil.com' },
        update: {
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
        { code: 'users', name: 'Tài khoản' }, // 👈 NEW
        { code: 'system', name: 'Hệ thống' }, // RBAC admin, v.v.
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

        // Employees
        { moduleCode: 'employees', code: 'employees.view', name: 'Xem nhân viên' },
        { moduleCode: 'employees', code: 'employees.create', name: 'Tạo nhân viên' },
        { moduleCode: 'employees', code: 'employees.update', name: 'Sửa nhân viên' },
        { moduleCode: 'employees', code: 'employees.delete', name: 'Xoá nhân viên' },

        // Users 👇 NEW
        { moduleCode: 'users', code: 'users.view', name: 'Xem tài khoản' },
        { moduleCode: 'users', code: 'users.create', name: 'Tạo tài khoản' },
        { moduleCode: 'users', code: 'users.update', name: 'Sửa tài khoản' },
        { moduleCode: 'users', code: 'users.delete', name: 'Xoá tài khoản' },
        { moduleCode: 'users', code: 'users.assign_roles', name: 'Gán quyền cho tài khoản' },
        { moduleCode: 'users', code: 'users.assign_employee', name: 'Gán nhân viên cho tài khoản' },
        { moduleCode: 'users', code: 'users.reset_password', name: 'Cấp mật khẩu mới' },

        // System
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

    // Gán toàn bộ permission cho system-admin (bao gồm users.*)
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
*/

const prisma = new PrismaClient()

async function main() {
    await prisma.priceRegion.upsert({
        where: { code: 'VUNG_I' },
        update: { name: 'Vùng I', isActive: true },
        create: { code: 'VUNG_I', name: 'Vùng I', isActive: true },
    })

    await prisma.priceRegion.upsert({
        where: { code: 'VUNG_II' },
        update: { name: 'Vùng II', isActive: true },
        create: { code: 'VUNG_II', name: 'Vùng II', isActive: true },
    })
}

main()
    .catch((e) => {
        console.error(e)
        process.exit(1)
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
