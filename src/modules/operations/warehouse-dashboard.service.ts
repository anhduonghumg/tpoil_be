import { Injectable } from '@nestjs/common'
import {
    CommercialLotWithdrawalStatus,
    ExpectedSupplyStatus,
    GoodsReceiptStatus,
    InventoryMovementStatus,
    Prisma,
    ReconciliationVarianceStatus,
    SalesDeliveryStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

/**
 * Nhóm mặt hàng của kho xăng dầu. Danh mục Product không có trường phân loại, nên
 * suy ra từ tên (và mã khi tên không rõ). Mọi thứ không nhận ra được rơi vào OTHER
 * chứ không bị bỏ đi — tồn kho mà biến mất khỏi tổng thì nguy hiểm hơn là nhóm sai.
 */
export type FuelGroupKey = 'GASOLINE' | 'DIESEL' | 'OTHER'

const GROUP_LABELS: Record<FuelGroupKey, string> = {
    GASOLINE: 'Xăng',
    DIESEL: 'Dầu',
    OTHER: 'Khác',
}

const stripAccents = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '')

export function classifyFuel(product: { code: string; name: string }): FuelGroupKey {
    const name = stripAccents(product.name).toLowerCase()
    const code = product.code.toUpperCase()

    if (name.includes('xang') || /^(A|E)\d/.test(code)) return 'GASOLINE'
    if (
        name.includes('diezen') ||
        name.includes('diesel') ||
        name.includes('dau') ||
        name.includes('do ') ||
        /^(DO|FO|KO)/.test(code)
    ) {
        return 'DIESEL'
    }
    return 'OTHER'
}

const num = (value: Prisma.Decimal | number | null | undefined) =>
    value == null ? 0 : Number(value)

type Bucket = {
    onHand: number
    reserved: number
    pending: number
    blocked: number
    sellable: number
}

const emptyBucket = (): Bucket => ({
    onHand: 0,
    reserved: 0,
    pending: 0,
    blocked: 0,
    sellable: 0,
})

const addTo = (
    bucket: Bucket,
    row: { onHand: number; reserved: number; pending: number; blocked: number },
) => {
    bucket.onHand += row.onHand
    bucket.reserved += row.reserved
    bucket.pending += row.pending
    bucket.blocked += row.blocked
    bucket.sellable += Math.max(row.onHand - row.reserved - row.pending - row.blocked, 0)
}

/**
 * Số liệu cho dashboard kho: tồn tách theo nhóm xăng / dầu, phân bổ theo kho, và các
 * hàng đợi chứng từ đang chờ kho xử lý.
 */
@Injectable()
export class WarehouseDashboardService {
    constructor(private readonly prisma: PrismaService) {}

    async get() {
        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const tomorrow = new Date(todayStart)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const soonLimit = new Date(todayStart)
        soonLimit.setDate(soonLimit.getDate() + 7)

        const [
            balances,
            receiptRequests,
            receiptsToday,
            lotWithdrawalsPending,
            salesDeliveriesReady,
            salesDeliveriesReturned,
            transfersInTransit,
            reconciliationVariance,
            expectedSoon,
            expectedTotals,
            receivedMonth,
            issuedMonth,
        ] = await Promise.all([
            // Chỉ hàng của chính công ty; hàng khách gửi kho theo dõi riêng.
            this.prisma.inventoryAvailabilityBalance.findMany({
                where: { owner: { legalEntities: { some: {} } } },
                select: {
                    warehouseId: true,
                    productId: true,
                    onHandActualQty: true,
                    reservedActualQty: true,
                    pendingActualQty: true,
                    blockedActualQty: true,
                    warehouse: { select: { id: true, code: true, name: true } },
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            }),
            this.prisma.goodsReceipt.count({ where: { status: GoodsReceiptStatus.DRAFT } }),
            this.prisma.goodsReceipt.count({
                where: {
                    status: GoodsReceiptStatus.CONFIRMED,
                    receiptDate: { gte: todayStart, lt: tomorrow },
                },
            }),
            this.prisma.commercialLotWithdrawal.count({
                where: { status: CommercialLotWithdrawalStatus.DRAFT },
            }),
            this.prisma.salesDelivery.count({ where: { status: SalesDeliveryStatus.READY } }),
            this.prisma.salesDelivery.count({ where: { status: SalesDeliveryStatus.RETURNED } }),
            this.prisma.inventoryMovement.count({
                where: {
                    status: {
                        in: [
                            InventoryMovementStatus.IN_TRANSIT,
                            InventoryMovementStatus.PARTIALLY_ARRIVED,
                        ],
                    },
                },
            }),
            this.prisma.reconciliationVariance.count({
                where: {
                    status: {
                        in: [
                            ReconciliationVarianceStatus.OPEN,
                            ReconciliationVarianceStatus.EXPLAINED,
                        ],
                    },
                    varianceActualQty: { not: 0 },
                },
            }),
            this.prisma.expectedSupply.count({
                where: {
                    status: {
                        in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED],
                    },
                    expectedAt: { gte: todayStart, lte: soonLimit },
                },
            }),
            this.prisma.expectedSupply.aggregate({
                where: {
                    status: {
                        in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED],
                    },
                },
                _sum: { expectedActualQty: true, fulfilledActualQty: true },
            }),
            // Nhập kho thật: phiếu nhập hàng đã xác nhận trong tháng.
            this.prisma.goodsReceiptLine.aggregate({
                where: {
                    goodsReceipt: {
                        status: GoodsReceiptStatus.CONFIRMED,
                        receiptDate: { gte: monthStart, lt: nextMonthStart },
                    },
                },
                _sum: { actualQty: true },
            }),
            // Xuất kho thật: dòng phiếu xuất bán đã ghi sổ trong tháng.
            this.prisma.salesDeliveryLine.aggregate({
                where: {
                    postedAt: { gte: monthStart, lt: nextMonthStart },
                    delivery: { status: SalesDeliveryStatus.POSTED },
                },
                _sum: { actualQty: true },
            }),
        ])

        const totals = emptyBucket()
        const groupBuckets = new Map<FuelGroupKey, Bucket>()
        const productBuckets = new Map<
            string,
            { group: FuelGroupKey; code: string; name: string; uom: string; bucket: Bucket }
        >()
        const warehouseBuckets = new Map<
            string,
            { code: string; name: string; groups: Map<FuelGroupKey, Bucket>; onHand: number }
        >()

        for (const balance of balances) {
            const row = {
                onHand: num(balance.onHandActualQty),
                reserved: num(balance.reservedActualQty),
                pending: num(balance.pendingActualQty),
                blocked: num(balance.blockedActualQty),
            }
            if (row.onHand === 0 && row.reserved === 0) continue

            const group = classifyFuel(balance.product)

            addTo(totals, row)

            if (!groupBuckets.has(group)) groupBuckets.set(group, emptyBucket())
            addTo(groupBuckets.get(group)!, row)

            if (!productBuckets.has(balance.productId)) {
                productBuckets.set(balance.productId, {
                    group,
                    code: balance.product.code,
                    name: balance.product.name,
                    uom: balance.product.uom,
                    bucket: emptyBucket(),
                })
            }
            addTo(productBuckets.get(balance.productId)!.bucket, row)

            if (!warehouseBuckets.has(balance.warehouseId)) {
                warehouseBuckets.set(balance.warehouseId, {
                    code: balance.warehouse.code,
                    name: balance.warehouse.name,
                    groups: new Map(),
                    onHand: 0,
                })
            }
            const warehouse = warehouseBuckets.get(balance.warehouseId)!
            warehouse.onHand += row.onHand
            if (!warehouse.groups.has(group)) warehouse.groups.set(group, emptyBucket())
            addTo(warehouse.groups.get(group)!, row)
        }

        const groupOrder: FuelGroupKey[] = ['GASOLINE', 'DIESEL', 'OTHER']

        const groups = groupOrder
            .filter((key) => groupBuckets.has(key))
            .map((key) => ({
                key,
                label: GROUP_LABELS[key],
                ...groupBuckets.get(key)!,
                products: Array.from(productBuckets.entries())
                    .filter(([, value]) => value.group === key)
                    .map(([productId, value]) => ({
                        productId,
                        code: value.code,
                        name: value.name,
                        uom: value.uom,
                        ...value.bucket,
                    }))
                    .sort((a, b) => b.onHand - a.onHand),
            }))

        const byWarehouse = Array.from(warehouseBuckets.entries())
            .map(([warehouseId, value]) => ({
                warehouseId,
                code: value.code,
                name: value.name,
                onHand: value.onHand,
                groups: groupOrder
                    .filter((key) => value.groups.has(key))
                    .map((key) => ({
                        key,
                        label: GROUP_LABELS[key],
                        ...value.groups.get(key)!,
                    })),
            }))
            .sort((a, b) => b.onHand - a.onHand)

        const expectedQty = Math.max(
            num(expectedTotals._sum.expectedActualQty) - num(expectedTotals._sum.fulfilledActualQty),
            0,
        )

        return {
            period: { today: todayStart.toISOString(), month: monthStart.getMonth() + 1 },
            stock: { totals, groups, byWarehouse },
            flow: {
                receivedMonth: num(receivedMonth._sum.actualQty),
                issuedMonth: num(issuedMonth._sum.actualQty),
                receiptsToday,
                expectedQty,
                expectedSoon,
            },
            queues: {
                receiptRequests,
                lotWithdrawalsPending,
                salesDeliveriesReady,
                salesDeliveriesReturned,
                transfersInTransit,
                reconciliationVariance,
            },
        }
    }
}
