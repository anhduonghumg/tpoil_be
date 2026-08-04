import { PrismaClient } from '@prisma/client'

const permissions = [
    ['sales.view', 'Xem phân hệ bán hàng'],
    ['sales.create', 'Tạo đơn bán'],
    ['sales.update', 'Sửa đơn bán'],
    ['sales.delete', 'Xóa đơn bán nháp'],
    ['sales.submit', 'Gửi đơn bán kiểm duyệt'],
    ['sales.recall', 'Thu hồi đơn bán đang chờ duyệt'],
    ['sales.cancel', 'Hủy đơn bán'],
    ['sales.approve_price', 'Duyệt giá/chiết khấu đơn bán'],
    ['sales.approve_credit', 'Duyệt tín dụng/công nợ đơn bán'],
    ['sales.approve_exception', 'Duyệt ngoại lệ đơn bán'],
    ['sales.delivery.confirm', 'Kho xác nhận lệnh xuất bán'],
    ['sales.delivery.return', 'Kho trả lại lệnh xuất cho Sale chỉnh sửa'],
    ['sales.delivery.void', 'Điều chỉnh/hủy lệnh xuất đã ghi nhận'],
    ['sales.reconcile', 'Đối soát lần giao hàng bán'],
    ['sales.invoice.view', 'Xem hóa đơn bán'],
    ['sales.invoice.issue', 'Phát hành hóa đơn bán'],
    ['sales.withdraw.create', 'Tạo yêu cầu rút lô'],
    ['sales.receivable.view', 'Xem công nợ phải thu'],
    ['sales.receivable.allocate', 'Đối trừ tiền về vào công nợ phải thu'],
    ['sales.profitability.view', 'Xem báo cáo lãi/lỗ theo nguồn hàng mua'],
    ['sales.quickentry.use', 'Dùng nhập nhanh đơn hàng'],
    ['sales.alias.manage', 'Quản lý danh mục cách viết tắt (alias)'],
] as const

export async function seedSalesPermissions(db: PrismaClient) {
    const moduleRow = await db.module.upsert({
        where: { code: 'sales' },
        update: { name: 'Bán hàng' },
        create: { code: 'sales', name: 'Bán hàng' },
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
