import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const USERS_MODULE = {
    code: 'USERS',
    name: 'Quản lý tài khoản',
}

const permissionsData = [
    { code: 'USERS_VIEW', name: 'Xem tài khoản' },
    { code: 'USERS_CREATE', name: 'Tạo tài khoản' },
    { code: 'USERS_UPDATE', name: 'Sửa tài khoản' },
    { code: 'USERS_DELETE', name: 'Xóa tài khoản' },
    { code: 'USERS_ASSIGN_ROLES', name: 'Gán quyền cho tài khoản' },
    { code: 'USERS_ASSIGN_EMPLOYEE', name: 'Gán nhân viên cho tài khoản' },
    { code: 'USERS_RESET_PASSWORD', name: 'Cấp mật khẩu mới' },
] as const

export async function seedUsersPermissions() {
    // 1) Upsert module
    const moduleRow = await prisma.module.upsert({
        where: { code: USERS_MODULE.code },
        update: { name: USERS_MODULE.name },
        create: { code: USERS_MODULE.code, name: USERS_MODULE.name },
    })

    // 2) Upsert permissions
    for (const p of permissionsData) {
        await prisma.permission.upsert({
            where: { code: p.code },
            update: { name: p.name, moduleId: moduleRow.id },
            create: { code: p.code, name: p.name, moduleId: moduleRow.id },
        })
    }

    return { moduleId: moduleRow.id, count: permissionsData.length }
}

// chạy độc lập nếu cần
if (require.main === module) {
    seedUsersPermissions()
        .then((r) => console.log('Seed USERS permissions OK:', r))
        .catch((e) => {
            console.error(e)
            process.exit(1)
        })
        .finally(async () => prisma.$disconnect())
}
