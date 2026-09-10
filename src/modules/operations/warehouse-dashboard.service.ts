import { Injectable } from '@nestjs/common'
import {
    CommercialLotWithdrawalStatus,
    CostLayerStatus,
    ExpectedSupplyStatus,
    GoodsReceiptStatus,
    InventoryMovementStatus,
    MasterStatus,
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

/** Cột SUM của $queryRaw về dạng numeric, Prisma trả Decimal chứ không phải number. */
const rawNum = (value: unknown) => (value == null ? 0 : Number(value))

type Bucket = {
    onHand: number
    reserved: number
    pending: number
    blocked: number
    sellable: number
    /** Phần đã cam kết vượt quá tồn, cộng dồn theo từng dòng tồn. Xem `addTo`. */
    shortfall: number
}

const emptyBucket = (): Bucket => ({
    onHand: 0,
    reserved: 0,
    pending: 0,
    blocked: 0,
    sellable: 0,
    shortfall: 0,
})

/**
 * `sellable` chỉ cộng phần dương: bán được của mặt hàng này không bù được cho mặt
 * hàng kia, nên tổng phải là tổng những phần thật sự bán được.
 *
 * Nhưng phần âm không được biến mất — trước đây nó bị `Math.max(..., 0)` nuốt và một
 * mặt hàng giữ vượt tồn vẫn hiện ra như bình thường. Giờ nó cộng vào `shortfall` để
 * dashboard cảnh báo được.
 */
const addTo = (
    bucket: Bucket,
    row: { onHand: number; reserved: number; pending: number; blocked: number },
) => {
    const available = row.onHand - row.reserved - row.pending - row.blocked
    bucket.onHand += row.onHand
    bucket.reserved += row.reserved
    bucket.pending += row.pending
    bucket.blocked += row.blocked
    bucket.sellable += Math.max(available, 0)
    bucket.shortfall += Math.max(-available, 0)
}

/** Một dòng tồn bất thường, đủ để người kho biết phải mở kho nào, mặt hàng nào. */
type StockAlertRow = {
    warehouseId: string
    warehouseCode: string
    warehouseName: string
    productId: string
    productName: string
    onHand: number
    qty: number
}

const ALERT_ROW_LIMIT = 5
const TOP_PRODUCT_LIMIT = 5
/** Số tháng của biểu đồ xu hướng, tính cả tháng đang chạy dở. */
const TREND_MONTHS = 12

const uuidLike = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

/** Một tháng trong biểu đồ nhập – xuất; `month` dạng YYYY-MM. */
type TrendRow = { month: string; received: number; issued: number }

type TopProductRow = { productId: string; code: string; name: string; qty: number }

/**
 * Số liệu cho dashboard kho: tồn tách theo nhóm xăng / dầu, phân bổ theo kho, và các
 * hàng đợi chứng từ đang chờ kho xử lý.
 */
@Injectable()
export class WarehouseDashboardService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * @param warehouseIdInput kho cần xem; bỏ trống là toàn bộ kho. Giá trị rác bị bỏ
     * qua thay vì để Prisma ném 500 — tham số này đến từ URL nên có thể cũ hoặc sai.
     */
    async get(warehouseIdInput?: string) {
        const warehouseId =
            warehouseIdInput && uuidLike(warehouseIdInput) ? warehouseIdInput : undefined

        const now = new Date()
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
        const tomorrow = new Date(todayStart)
        tomorrow.setDate(tomorrow.getDate() + 1)
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const soonLimit = new Date(todayStart)
        soonLimit.setDate(soonLimit.getDate() + 7)
        const trendStart = new Date(now.getFullYear(), now.getMonth() - (TREND_MONTHS - 1), 1)

        // Bảng nào cũng có cột kho nhưng tên khác nhau, nên lọc viết riêng theo tên cột.
        const atWarehouse = warehouseId ? { warehouseId } : {}
        const withdrawalAt = warehouseId ? { destinationWarehouseId: warehouseId } : {}
        // Chuyển kho tính cả chiều đi lẫn chiều đến: kho nào cũng đang phải theo dõi lô đó.
        const transferAt = warehouseId
            ? { OR: [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }] }
            : {}
        const varianceAt = warehouseId ? { session: { warehouseId } } : {}

        const [
            warehouses,
            balances,
            receiptRequests,
            receiptsToday,
            deliveriesToday,
            lotWithdrawalsPending,
            salesDeliveriesReady,
            salesDeliveriesReturned,
            transfersInTransit,
            reconciliationVariance,
            expectedSoon,
            expectedTotals,
            receivedMonth,
            issuedMonth,
            costLayers,
            lotBalances,
            trendRows,
            topIssuedRows,
        ] = await Promise.all([
            // Danh sách cho ô chọn kho: luôn lấy đủ, không phụ thuộc kho đang xem.
            this.prisma.warehouse.findMany({
                where: { status: MasterStatus.ACTIVE },
                select: { id: true, code: true, name: true },
                orderBy: { code: 'asc' },
            }),
            // Chỉ hàng của chính công ty; hàng khách gửi kho theo dõi riêng.
            this.prisma.inventoryAvailabilityBalance.findMany({
                where: { owner: { legalEntities: { some: {} } }, ...atWarehouse },
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
            this.prisma.goodsReceipt.count({
                where: { status: GoodsReceiptStatus.DRAFT, ...atWarehouse },
            }),
            this.prisma.goodsReceipt.count({
                where: {
                    status: GoodsReceiptStatus.CONFIRMED,
                    receiptDate: { gte: todayStart, lt: tomorrow },
                    ...atWarehouse,
                },
            }),
            // Kho xác nhận xuất xong là phiếu sang POSTED, `confirmedAt` là lúc kho ký.
            this.prisma.salesDelivery.count({
                where: {
                    status: SalesDeliveryStatus.POSTED,
                    confirmedAt: { gte: todayStart, lt: tomorrow },
                    ...atWarehouse,
                },
            }),
            this.prisma.commercialLotWithdrawal.count({
                where: { status: CommercialLotWithdrawalStatus.DRAFT, ...withdrawalAt },
            }),
            this.prisma.salesDelivery.count({
                where: { status: SalesDeliveryStatus.READY, ...atWarehouse },
            }),
            this.prisma.salesDelivery.count({
                where: { status: SalesDeliveryStatus.RETURNED, ...atWarehouse },
            }),
            this.prisma.inventoryMovement.count({
                where: {
                    status: {
                        in: [
                            InventoryMovementStatus.IN_TRANSIT,
                            InventoryMovementStatus.PARTIALLY_ARRIVED,
                        ],
                    },
                    ...transferAt,
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
                    ...varianceAt,
                },
            }),
            this.prisma.expectedSupply.count({
                where: {
                    status: {
                        in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED],
                    },
                    expectedAt: { gte: todayStart, lte: soonLimit },
                    ...atWarehouse,
                },
            }),
            this.prisma.expectedSupply.aggregate({
                where: {
                    status: {
                        in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED],
                    },
                    ...atWarehouse,
                },
                _sum: { expectedActualQty: true, fulfilledActualQty: true },
            }),
            // Nhập kho thật: phiếu nhập hàng đã xác nhận trong tháng.
            this.prisma.goodsReceiptLine.aggregate({
                where: {
                    goodsReceipt: {
                        status: GoodsReceiptStatus.CONFIRMED,
                        receiptDate: { gte: monthStart, lt: nextMonthStart },
                        ...atWarehouse,
                    },
                },
                _sum: { actualQty: true },
            }),
            // Xuất kho thật: dòng phiếu xuất bán đã ghi sổ trong tháng.
            this.prisma.salesDeliveryLine.aggregate({
                where: {
                    postedAt: { gte: monthStart, lt: nextMonthStart },
                    delivery: { status: SalesDeliveryStatus.POSTED, ...atWarehouse },
                },
                _sum: { actualQty: true },
            }),
            // Lớp giá vốn còn mở: nguồn duy nhất biết một lít trong kho đáng bao nhiêu.
            this.prisma.inventoryCostLayer.findMany({
                where: {
                    status: CostLayerStatus.OPEN,
                    owner: { legalEntities: { some: {} } },
                },
                select: {
                    inventoryLotId: true,
                    ownerPartyId: true,
                    remainingActualQty: true,
                    remainingValue: true,
                    currency: true,
                    isProvisional: true,
                },
            }),
            // Lớp giá vốn không gắn kho, chỉ gắn lô — muốn biết tiền nằm ở kho nào thì
            // phải đi qua tồn theo lô.
            this.prisma.stockBalance.findMany({
                where: {
                    owner: { legalEntities: { some: {} } },
                    actualQty: { not: 0 },
                    ...atWarehouse,
                },
                select: {
                    warehouseId: true,
                    productId: true,
                    ownerPartyId: true,
                    inventoryLotId: true,
                    actualQty: true,
                },
            }),
            /*
             * Xu hướng lấy đúng hai nguồn mà KPI "nhập/xuất trong tháng" đang dùng —
             * phiếu nhập đã xác nhận và dòng xuất bán đã ghi sổ — chứ không lấy sổ cái
             * kho. Sổ cái tính cả chuyển kho nội bộ, cột tháng này sẽ vênh với KPI ngay
             * bên trên và không ai biết tin số nào.
             */
            this.prisma.$queryRaw<Array<{ month: string; received: unknown; issued: unknown }>>(
                Prisma.sql`
                    WITH months AS (
                        SELECT to_char(m, 'YYYY-MM') AS month
                        FROM generate_series(
                            date_trunc('month', ${trendStart}::timestamptz),
                            date_trunc('month', now()),
                            interval '1 month'
                        ) m
                    )
                    SELECT months.month AS month,
                           COALESCE(SUM(CASE WHEN flow.direction = 'IN' THEN flow.qty ELSE 0 END), 0) AS received,
                           COALESCE(SUM(CASE WHEN flow.direction = 'OUT' THEN flow.qty ELSE 0 END), 0) AS issued
                    FROM months
                    LEFT JOIN (
                        SELECT gr."receiptDate" AS at, 'IN' AS direction, grl."actualQty" AS qty
                        FROM "GoodsReceiptLine" grl
                        JOIN "GoodsReceipt" gr ON gr.id = grl."goodsReceiptId"
                        WHERE gr.status = 'CONFIRMED'
                          AND gr."receiptDate" >= ${trendStart}
                          ${
                              warehouseId
                                  ? Prisma.sql`AND gr."warehouseId" = ${warehouseId}::uuid`
                                  : Prisma.empty
                          }
                        UNION ALL
                        SELECT sdl."postedAt" AS at, 'OUT' AS direction, COALESCE(sdl."actualQty", 0) AS qty
                        FROM "SalesDeliveryLine" sdl
                        JOIN "SalesDelivery" sd ON sd.id = sdl."salesDeliveryId"
                        WHERE sd.status = 'POSTED'
                          AND sdl."postedAt" >= ${trendStart}
                          ${
                              warehouseId
                                  ? Prisma.sql`AND sd."warehouseId" = ${warehouseId}::uuid`
                                  : Prisma.empty
                          }
                    ) flow ON to_char(date_trunc('month', flow.at), 'YYYY-MM') = months.month
                    GROUP BY months.month
                    ORDER BY months.month
                `,
            ),
            // SalesDeliveryLine không giữ productId, mặt hàng nằm ở dòng đơn bán.
            this.prisma.$queryRaw<
                Array<{ productId: string; code: string; name: string; qty: unknown }>
            >(
                Prisma.sql`
                    SELECT sol."productId" AS "productId", p.code, p.name,
                           SUM(COALESCE(sdl."actualQty", 0)) AS qty
                    FROM "SalesDeliveryLine" sdl
                    JOIN "SalesDelivery" sd ON sd.id = sdl."salesDeliveryId"
                    JOIN "SalesOrderLine" sol ON sol.id = sdl."salesOrderLineId"
                    JOIN "Product" p ON p.id = sol."productId"
                    WHERE sd.status = 'POSTED'
                      AND sdl."postedAt" >= ${trendStart}
                      ${
                          warehouseId
                              ? Prisma.sql`AND sd."warehouseId" = ${warehouseId}::uuid`
                              : Prisma.empty
                      }
                    GROUP BY sol."productId", p.code, p.name
                    HAVING SUM(COALESCE(sdl."actualQty", 0)) > 0
                    ORDER BY qty DESC
                    LIMIT ${TOP_PRODUCT_LIMIT}
                `,
            ),
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

        const negativeOnHand: StockAlertRow[] = []
        const overCommitted: StockAlertRow[] = []
        const zeroOnHand: StockAlertRow[] = []

        for (const balance of balances) {
            const row = {
                onHand: num(balance.onHandActualQty),
                reserved: num(balance.reservedActualQty),
                pending: num(balance.pendingActualQty),
                blocked: num(balance.blockedActualQty),
            }

            /*
             * Tồn bằng 0 phải bắt TRƯỚC chỗ bỏ qua dòng rỗng: có dòng trong bảng tồn
             * nghĩa là kho này từng có mặt hàng này, giờ hết sạch — đó là tin cần biết
             * để lập lệnh nhập, không phải dòng rác.
             */
            if (row.onHand === 0) {
                zeroOnHand.push({
                    warehouseId: balance.warehouseId,
                    warehouseCode: balance.warehouse.code,
                    warehouseName: balance.warehouse.name,
                    productId: balance.productId,
                    productName: balance.product.name,
                    onHand: 0,
                    qty: 0,
                })
            }

            // Dòng sạch trơn thì bỏ qua; chỉ cần một cột khác 0 là còn chuyện để xem,
            // kể cả khi tồn bằng 0 mà vẫn đang giữ hàng — đó chính là ca cần cảnh báo.
            if (!row.onHand && !row.reserved && !row.pending && !row.blocked) continue

            const available = row.onHand - row.reserved - row.pending - row.blocked
            if (row.onHand < 0 || available < 0) {
                const alertRow: StockAlertRow = {
                    warehouseId: balance.warehouseId,
                    warehouseCode: balance.warehouse.code,
                    warehouseName: balance.warehouse.name,
                    productId: balance.productId,
                    productName: balance.product.name,
                    onHand: row.onHand,
                    qty: row.onHand < 0 ? -row.onHand : -available,
                }
                if (row.onHand < 0) negativeOnHand.push(alertRow)
                else overCommitted.push(alertRow)
            }

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

        /*
         * Giá vốn tồn. Lớp giá vốn chỉ gắn với lô chứ không gắn kho, nên đơn giá lấy từ
         * lớp (giá trị còn lại / lượng còn lại) rồi nhân với tồn theo lô ở từng kho.
         *
         * Nhân đơn giá chứ không chia đều giá trị lớp theo tỷ lệ: khi lọc một kho, con
         * số phải là tiền thật đang nằm ở kho đó. Đổi lại, nếu tồn theo lô lệch với
         * lượng còn lại của lớp thì tổng sẽ lệch với sổ giá vốn — đó là sai lệch dữ
         * liệu, để nó lộ ra vẫn hơn là che bằng phép chia tỷ lệ.
         */
        const unitCosts = new Map<
            string,
            { unit: number; currency: string; provisional: boolean }
        >()
        for (const layer of costLayers) {
            const remaining = num(layer.remainingActualQty)
            if (remaining <= 0) continue
            unitCosts.set(`${layer.inventoryLotId}|${layer.ownerPartyId}`, {
                unit: num(layer.remainingValue) / remaining,
                currency: layer.currency,
                provisional: layer.isProvisional,
            })
        }

        const valueByCurrency = new Map<string, number>()
        for (const balance of lotBalances) {
            const cost = unitCosts.get(`${balance.inventoryLotId}|${balance.ownerPartyId}`)
            if (!cost) continue
            const value = num(balance.actualQty) * cost.unit
            valueByCurrency.set(cost.currency, (valueByCurrency.get(cost.currency) ?? 0) + value)
        }

        // Cộng tiền khác loại tiền tệ với nhau là vô nghĩa, nên chỉ lấy một loại làm số
        // chính — VND nếu có, còn không thì loại đang chiếm nhiều tiền nhất.
        const primaryCurrency =
            (valueByCurrency.has('VND')
                ? 'VND'
                : Array.from(valueByCurrency.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]) ??
            'VND'

        let valueTotal = 0
        let valueProvisional = 0
        let costedQty = 0
        let uncostedQty = 0
        const valueByWarehouse = new Map<string, number>()
        for (const balance of lotBalances) {
            const cost = unitCosts.get(`${balance.inventoryLotId}|${balance.ownerPartyId}`)
            const balanceQty = num(balance.actualQty)

            /*
             * Đơn giá 0 tính là CHƯA có giá vốn, không phải hàng miễn phí: lớp giá tạm
             * mở ra mà chưa gắn giá thì `remainingValue` vẫn là 0. Gộp nó vào tổng sẽ ra
             * "kho trị giá 0đ" — sai hẳn nghĩa so với "chưa biết kho trị giá bao nhiêu".
             */
            if (!cost || cost.unit === 0) {
                uncostedQty += balanceQty
                continue
            }
            // Lô ghi bằng loại tiền khác đã có giá vốn, chỉ là không cộng chung được.
            if (cost.currency !== primaryCurrency) continue

            const value = balanceQty * cost.unit
            costedQty += balanceQty
            valueTotal += value
            if (cost.provisional) valueProvisional += value
            valueByWarehouse.set(
                balance.warehouseId,
                (valueByWarehouse.get(balance.warehouseId) ?? 0) + value,
            )
        }

        const trend: TrendRow[] = trendRows.map((row) => ({
            month: row.month,
            received: rawNum(row.received),
            issued: rawNum(row.issued),
        }))

        const topIssued: TopProductRow[] = topIssuedRows.map((row) => ({
            productId: row.productId,
            code: row.code,
            name: row.name,
            qty: rawNum(row.qty),
        }))

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

        // Đặt tên rõ là `rowWarehouseId`: `warehouseId` ở ngoài là kho đang lọc, trùng
        // tên trong callback thì đọc lại rất dễ hiểu sai.
        const byWarehouse = Array.from(warehouseBuckets.entries())
            .map(([rowWarehouseId, bucket]) => ({
                warehouseId: rowWarehouseId,
                code: bucket.code,
                name: bucket.name,
                onHand: bucket.onHand,
                value: valueByWarehouse.get(rowWarehouseId) ?? 0,
                groups: groupOrder
                    .filter((key) => bucket.groups.has(key))
                    .map((key) => ({
                        key,
                        label: GROUP_LABELS[key],
                        ...bucket.groups.get(key)!,
                    })),
            }))
            .sort((a, b) => b.onHand - a.onHand)

        const expectedQty = Math.max(
            num(expectedTotals._sum.expectedActualQty) - num(expectedTotals._sum.fulfilledActualQty),
            0,
        )

        const byQtyDesc = (a: StockAlertRow, b: StockAlertRow) => b.qty - a.qty

        return {
            period: { today: todayStart.toISOString(), month: monthStart.getMonth() + 1 },
            scope: {
                warehouseId: warehouseId ?? null,
                warehouses: warehouses.map((item) => ({
                    id: item.id,
                    code: item.code,
                    name: item.name,
                })),
            },
            stock: { totals, groups, byWarehouse },
            value: {
                currency: primaryCurrency,
                total: valueTotal,
                provisional: valueProvisional,
                // Bao nhiêu lít đứng sau con số tiền, và bao nhiêu lít chưa có giá vốn.
                // Thiếu hai số này thì `total` = 0 không phân biệt được "kho rỗng" với
                // "kho đầy hàng nhưng kế toán chưa gán giá".
                costedQty,
                uncostedQty,
                // Còn loại tiền khác nằm ngoài con số trên; màn hình phải nói ra.
                mixedCurrency: valueByCurrency.size > 1,
            },
            trend: { months: trend, topIssued },
            alerts: {
                // Xuất quá tồn: sổ sách đang sai, phải đối chiếu chứ không chỉ là cảnh báo.
                negativeOnHand: {
                    count: negativeOnHand.length,
                    qty: negativeOnHand.reduce((sum, item) => sum + item.qty, 0),
                    items: negativeOnHand.sort(byQtyDesc).slice(0, ALERT_ROW_LIMIT),
                },
                // Còn tồn nhưng đã hứa hết: bán tiếp là thiếu hàng.
                overCommitted: {
                    count: overCommitted.length,
                    qty: overCommitted.reduce((sum, item) => sum + item.qty, 0),
                    items: overCommitted.sort(byQtyDesc).slice(0, ALERT_ROW_LIMIT),
                },
                // Hết sạch tại kho từng có hàng. `qty` luôn 0 — ở đây chỉ có số dòng
                // mới có nghĩa, giữ nguyên hình dạng để màn hình dùng chung một kiểu.
                zeroOnHand: {
                    count: zeroOnHand.length,
                    qty: 0,
                    items: zeroOnHand.slice(0, ALERT_ROW_LIMIT),
                },
            },
            flow: {
                receivedMonth: num(receivedMonth._sum.actualQty),
                issuedMonth: num(issuedMonth._sum.actualQty),
                receiptsToday,
                deliveriesToday,
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
