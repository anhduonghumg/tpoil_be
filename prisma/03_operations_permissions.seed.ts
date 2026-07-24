import { PrismaClient } from '@prisma/client'

const permissions = [
    ['operations.view', 'Xem phân hệ vận hành'],
    ['operations.charter.manage', 'Quản lý thuê tàu và bảo hiểm'],
    ['operations.warehouse.manage', 'Quản lý kho vận hành'],
    ['operations.road.manage', 'Quản lý xe và điều xe'],
    ['operations.partners.manage', 'Quản lý vai trò đối tác vận hành'],
    ['operations.term_costs.post', 'Đưa chi phí vận hành vào giá vốn TERM'],
    ['operations.charter.vessel_documents.override', 'Cho phép xác nhận đơn khi hồ sơ tàu chưa hợp lệ'],
] as const

export async function seedOperationsPermissions(db: PrismaClient) {
    const moduleRow = await db.module.upsert({
        where: { code: 'operations' },
        update: { name: 'Vận hành' },
        create: { code: 'operations', name: 'Vận hành' },
    })

    const permissionRows: Array<{ id: string }> = []
    for (const [code, name] of permissions) {
        permissionRows.push(
            await db.permission.upsert({
                where: { code },
                update: { name, moduleId: moduleRow.id },
                create: { code, name, moduleId: moduleRow.id },
            }),
        )
    }

    const systemAdmin = await db.role.findUnique({
        where: { code: 'system-admin' },
        select: { id: true },
    })
    if (systemAdmin) {
        await db.rolePermission.createMany({
            data: permissionRows.map((permission) => ({
                roleId: systemAdmin.id,
                permissionId: permission.id,
            })),
            skipDuplicates: true,
        })
    }

    return {
        moduleId: moduleRow.id,
        permissionCount: permissionRows.length,
    }
}

if (require.main === module) {
    const prisma = new PrismaClient()
    seedOperationsPermissions(prisma)
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error)
            process.exitCode = 1
        })
        .finally(() => prisma.$disconnect())
}
