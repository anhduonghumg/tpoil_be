import {
    AvailabilityLedgerSourceType,
    PrismaClient,
    WarehouseOwnerType,
} from '@prisma/client'

const prisma = new PrismaClient()

const permissions = [
    ['operations.view', 'Xem phân hệ vận hành'],
    ['operations.charter.manage', 'Quản lý thuê tàu và bảo hiểm'],
    ['operations.warehouse.manage', 'Quản lý kho vận hành'],
    ['operations.road.manage', 'Quản lý xe và điều xe'],
    ['operations.partners.manage', 'Quản lý vai trò đối tác vận hành'],
    ['operations.term_costs.post', 'Đưa chi phí vận hành vào giá vốn TERM'],
] as const

export async function seedOperationsPermissions() {
    const moduleRow = await prisma.module.upsert({
        where: { code: 'operations' },
        update: { name: 'Vận hành' },
        create: { code: 'operations', name: 'Vận hành' },
    })

    const permissionRows = []
    for (const [code, name] of permissions) {
        permissionRows.push(
            await prisma.permission.upsert({
                where: { code },
                update: { name, moduleId: moduleRow.id },
                create: { code, name, moduleId: moduleRow.id },
            }),
        )
    }

    const systemAdmin = await prisma.role.findUnique({
        where: { code: 'system-admin' },
        select: { id: true },
    })
    if (systemAdmin) {
        await prisma.rolePermission.createMany({
            data: permissionRows.map((permission) => ({
                roleId: systemAdmin.id,
                permissionId: permission.id,
            })),
            skipDuplicates: true,
        })
    }

    const accountingBalances = await prisma.inventoryBalance.findMany()
    for (const accounting of accountingBalances) {
        const balance = await prisma.warehouseAvailabilityBalance.upsert({
            where: {
                supplierLocationId_productId_ownerKey: {
                    supplierLocationId: accounting.supplierLocationId,
                    productId: accounting.productId,
                    ownerKey: 'INTERNAL',
                },
            },
            update: {},
            create: {
                supplierLocationId: accounting.supplierLocationId,
                productId: accounting.productId,
                ownerType: WarehouseOwnerType.INTERNAL,
                ownerKey: 'INTERNAL',
                availableQty: accounting.physicalQty,
            },
        })
        await prisma.warehouseAvailabilityLedger.upsert({
            where: {
                sourceType_sourceId_sourceAction_supplierLocationId_productId_ownerKey: {
                    sourceType: AvailabilityLedgerSourceType.MANUAL,
                    sourceId: balance.id,
                    sourceAction: 'MIGRATION_BACKFILL',
                    supplierLocationId: balance.supplierLocationId,
                    productId: balance.productId,
                    ownerKey: balance.ownerKey,
                },
            },
            update: {},
            create: {
                supplierLocationId: balance.supplierLocationId,
                productId: balance.productId,
                ownerType: balance.ownerType,
                ownerKey: balance.ownerKey,
                deltaAvailableQty: balance.availableQty,
                afterAvailableQty: balance.availableQty,
                afterReservedQty: balance.reservedQty,
                afterInTransitQty: balance.inTransitQty,
                afterExpectedQty: balance.expectedQty,
                sourceType: AvailabilityLedgerSourceType.MANUAL,
                sourceId: balance.id,
                sourceAction: 'MIGRATION_BACKFILL',
                occurredAt: new Date(),
                note: 'Khởi tạo tồn kinh doanh từ InventoryBalance.physicalQty',
            },
        })
    }

    return {
        moduleId: moduleRow.id,
        permissionCount: permissionRows.length,
        availabilityBackfillCount: accountingBalances.length,
    }
}

if (require.main === module) {
    seedOperationsPermissions()
        .then((result) => console.log(JSON.stringify(result)))
        .catch((error) => {
            console.error(error)
            process.exitCode = 1
        })
        .finally(() => prisma.$disconnect())
}
