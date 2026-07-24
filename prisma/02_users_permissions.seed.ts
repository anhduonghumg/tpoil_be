import { PrismaClient } from '@prisma/client'

const USERS_MODULE = {
    code: 'users',
    name: 'Quản lý tài khoản',
}

const permissionsData = [
    { code: 'users.view', name: 'Xem tài khoản' },
    { code: 'users.create', name: 'Tạo tài khoản' },
    { code: 'users.update', name: 'Sửa tài khoản' },
    { code: 'users.delete', name: 'Xóa tài khoản' },
    { code: 'users.assign_roles', name: 'Gán quyền cho tài khoản' },
    { code: 'users.assign_employee', name: 'Gán nhân viên cho tài khoản' },
    { code: 'users.reset_password', name: 'Cấp mật khẩu mới' },
] as const

export async function seedUsersPermissions(db: PrismaClient) {
    const moduleRow = await db.module.upsert({
        where: { code: USERS_MODULE.code },
        update: { name: USERS_MODULE.name },
        create: { code: USERS_MODULE.code, name: USERS_MODULE.name },
    })

    for (const permission of permissionsData) {
        await db.permission.upsert({
            where: { code: permission.code },
            update: { name: permission.name, moduleId: moduleRow.id },
            create: { code: permission.code, name: permission.name, moduleId: moduleRow.id },
        })
    }

    return { moduleId: moduleRow.id, count: permissionsData.length }
}

if (require.main === module) {
    const prisma = new PrismaClient()
    seedUsersPermissions(prisma)
        .then((result) => console.log('Seed USERS permissions OK:', result))
        .catch((error) => {
            console.error(error)
            process.exit(1)
        })
        .finally(async () => prisma.$disconnect())
}
