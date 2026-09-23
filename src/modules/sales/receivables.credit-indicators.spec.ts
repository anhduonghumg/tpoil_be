import { CollectionPlanStatus, CustomerReceiptStatus, Prisma, ReceivableEntryType } from '@prisma/client'
import { ReceivablesService } from './receivables.service'

/**
 * Công thức của hai màn "Chỉ số công nợ" và "Đánh giá hạn mức năm".
 *
 * Mỗi nhóm test ứng với một lỗi đã tìm ra khi rà công thức; giữ lại để lần sau ai sửa
 * chỗ này cũng không vô tình làm sai lại.
 */

const D = (value: number | string) => new Prisma.Decimal(value)
const at = (date: string, time = '10:00:00') => new Date(`${date}T${time}`)

const customer = (overrides: Record<string, unknown> = {}) => ({
    id: 'c1',
    code: 'KH01',
    name: 'Khách 01',
    creditLimit: D(1_000),
    tempLimit: null,
    tempFrom: null,
    tempTo: null,
    ...overrides,
})

const entry = (type: ReceivableEntryType, amount: number, date: string) => ({
    type,
    amountDelta: D(amount),
    effectiveAt: at(date),
})

function setup(options: {
    entries?: ReturnType<typeof entry>[]
    customer?: ReturnType<typeof customer>
    history?: Array<Record<string, unknown>>
    plans?: Array<Record<string, unknown>>
    dueDate?: Date | null
}) {
    const cust = options.customer ?? customer()
    const prisma = {
        receivableOpenItem: {
            // Service lọc bút toán theo effectiveAt <= to trong câu truy vấn; mock làm y như vậy.
            findMany: jest.fn(async (args: any) => {
                const to: Date = args.include.entries.where.effectiveAt.lte
                return [
                    {
                        customer: cust,
                        dueDate: options.dueDate ?? null,
                        entries: (options.entries ?? []).filter((e) => e.effectiveAt <= to),
                    },
                ]
            }),
        },
        customerCollectionPlan: {
            findMany: jest.fn(async (args: any) => {
                const statuses: string[] = args.where.status.in
                const { gte, lte } = args.where.plannedDate
                return (options.plans ?? []).filter(
                    (plan: any) =>
                        statuses.includes(plan.status) && plan.plannedDate >= gte && plan.plannedDate <= lte,
                )
            }),
        },
        customerReceipt: { findMany: jest.fn(async () => []) },
        creditLimitHistory: {
            findMany: jest.fn(async () => options.history ?? []),
        },
        creditLimitProposal: { findMany: jest.fn(async () => []) },
    }
    return { service: new ReceivablesService(prisma as any, {} as any), prisma }
}

// Đồng hồ cố định cho cả file: service không cho kỳ báo cáo vượt quá hôm nay, nên nếu
// để đồng hồ thật thì kết quả test sẽ đổi theo ngày chạy.
beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    jest.setSystemTime(at('2026-10-15', '12:00:00'))
})
afterAll(() => jest.useRealTimers())

const row = async (service: ReceivablesService, fromDate: string, toDate: string) => {
    const result = await service.creditManagement({ fromDate, toDate } as any)
    return result.items[0]
}

describe('Chỉ số công nợ — phân loại bút toán', () => {
    it('đảo một khoản tiền đã thu không được thành "phát sinh nợ"', async () => {
        const { service } = setup({
            entries: [
                entry(ReceivableEntryType.OPEN, 500, '2026-09-02'),
                entry(ReceivableEntryType.RECEIPT, -100, '2026-09-05'),
                // Phân bổ nhầm khách rồi đảo lại: nợ quay về, không có lít hàng nào bán thêm.
                entry(ReceivableEntryType.REVERSAL, 100, '2026-09-10'),
            ],
        })

        const r = await row(service, '2026-09-01', '2026-09-15')

        expect(r.debtIncrease).toBe('500')
        expect(r.collectedAmount).toBe('0')
        expect(r.closingDebt).toBe('500')
    })

    it('hủy số dư đầu kỳ (REVERSAL âm) là giảm khác, không phải tiền thu', async () => {
        const { service } = setup({
            entries: [
                entry(ReceivableEntryType.OPEN, 300, '2026-08-20'),
                entry(ReceivableEntryType.REVERSAL, -300, '2026-09-03'),
            ],
        })

        const r = await row(service, '2026-09-01', '2026-09-15')

        expect(r.openingDebt).toBe('300')
        expect(r.collectedAmount).toBe('0')
        expect(r.otherDecrease).toBe('300')
        expect(r.closingDebt).toBe('0')
    })

    it('dòng luôn cộng khớp: đầu kỳ + phát sinh − đã thu − giảm khác = cuối kỳ', async () => {
        const { service } = setup({
            entries: [
                entry(ReceivableEntryType.OPEN, 800, '2026-08-25'),
                entry(ReceivableEntryType.OPEN, 400, '2026-09-04'),
                entry(ReceivableEntryType.RECEIPT, -250, '2026-09-06'),
                entry(ReceivableEntryType.REVERSAL, 50, '2026-09-08'),
                entry(ReceivableEntryType.CREDIT_NOTE, -30, '2026-09-09'),
            ],
        })

        const r = await row(service, '2026-09-01', '2026-09-15')
        const reconciled = D(r.openingDebt)
            .plus(r.debtIncrease)
            .minus(r.collectedAmount)
            .minus(r.otherDecrease)

        expect(reconciled.toString()).toBe(r.closingDebt)
        expect(r.closingDebt).toBe('970')
    })
})

describe('Chỉ số công nợ — hạn mức của kỳ cũ', () => {
    it('trước lần đổi đầu tiên dùng hạn mức cũ, không dùng hạn mức hiện tại', async () => {
        const { service } = setup({
            // Hạn mức hiện tại đã là 2.000 sau khi nâng vào tháng 6.
            customer: customer({ creditLimit: D(2_000) }),
            history: [
                {
                    customerId: 'c1',
                    changedAt: at('2026-06-15'),
                    oldLimit: D(1_000),
                    newLimit: D(2_000),
                    tempLimit: null,
                    tempFrom: null,
                    tempTo: null,
                },
            ],
            entries: [entry(ReceivableEntryType.OPEN, 1_500, '2026-03-05')],
        })

        const r = await row(service, '2026-03-01', '2026-03-31')

        expect(r.creditLimit).toBe('1000')
        expect(r.overAmount).toBe('500')
        expect(r.overRate).toBe('50')
    })
})

describe('Chỉ số công nợ — kế hoạch thu', () => {
    const plan = (overrides: Record<string, unknown>) => ({
        customer: customer(),
        plannedAmount: D(100),
        receipts: [],
        ...overrides,
    })

    it('lời hứa đã hẹn lại vẫn tính là lỡ trong kỳ gốc', async () => {
        const { service } = setup({
            plans: [
                plan({
                    status: CollectionPlanStatus.COMPLETED,
                    plannedDate: at('2026-09-05', '00:00:00'),
                    receipts: [{ amount: D(100), status: CustomerReceiptStatus.CONFIRMED, receivedAt: at('2026-09-05') }],
                }),
                plan({ status: CollectionPlanStatus.CARRIED_FORWARD, plannedDate: at('2026-09-12', '00:00:00') }),
                plan({ status: CollectionPlanStatus.CARRIED_FORWARD, plannedDate: at('2026-09-20', '00:00:00') }),
            ],
        })

        const r = await row(service, '2026-09-01', '2026-09-30')

        expect(r.plannedAmount).toBe('300')
        expect(r.plannedActualAmount).toBe('100')
        expect(Number(r.planCompletionRate)).toBeCloseTo(33.33, 2)
    })

    it('tiền trả sau ngày cuối kỳ không tính cho kỳ đó', async () => {
        const { service } = setup({
            plans: [
                plan({
                    status: CollectionPlanStatus.COMPLETED,
                    plannedDate: at('2026-08-25', '00:00:00'),
                    receipts: [{ amount: D(100), status: CustomerReceiptStatus.CONFIRMED, receivedAt: at('2026-09-03') }],
                }),
            ],
        })

        const r = await row(service, '2026-08-01', '2026-08-31')

        expect(r.plannedActualAmount).toBe('0')
        expect(r.planCompletionRate).toBe('0')
    })
})

describe('Chỉ số công nợ — hạn mức bằng 0 (không cho nợ)', () => {
    it('còn nợ ngày nào là một ngày vượt', async () => {
        const { service } = setup({
            customer: customer({ creditLimit: D(0) }),
            entries: [entry(ReceivableEntryType.OPEN, 200, '2026-09-10')],
        })

        const r = await row(service, '2026-09-01', '2026-09-15')

        // Nợ từ 10/9 đến hết 15/9 = 6 ngày.
        expect(r.daysOverLimit).toBe(6)
        expect(r.overRate).toBeNull()
    })
})

describe('Đánh giá hạn mức năm', () => {
    it('tỷ lệ vượt so từng ngày với hạn mức đúng ngày đó, không so đỉnh nợ với hạn mức 31/12', async () => {
        const { service } = setup({
            customer: customer({ creditLimit: D(2_000) }),
            history: [
                {
                    customerId: 'c1',
                    changedAt: at('2025-07-01'),
                    oldLimit: D(1_000),
                    newLimit: D(2_000),
                    tempLimit: null,
                    tempFrom: null,
                    tempTo: null,
                },
            ],
            entries: [
                entry(ReceivableEntryType.OPEN, 1_400, '2025-03-10'),
                entry(ReceivableEntryType.RECEIPT, -1_400, '2025-03-20'),
            ],
        })

        const result = await service.annualCreditIndicators(2025)
        const r = result.items[0]

        // Tháng 3 nợ 1.400 trên hạn mức 1.000 → vượt 40%, dù cuối năm hạn mức đã là 2.000.
        expect(r.annualOverRate).toBe('40')
        expect(r.creditLimitAtStart).toBe('1000')
        expect(r.creditLimit).toBe('2000')
        expect(r.daysOverLimit).toBe(10)
    })

    it('năm đang chạy chỉ tính tới hôm nay, không tính các ngày chưa tới', async () => {
        jest.setSystemTime(at('2026-09-19', '12:00:00'))
        const { service } = setup({
            entries: [entry(ReceivableEntryType.OPEN, 1_500, '2026-09-10')],
        })

        const result = await service.annualCreditIndicators(2026)
        const r = result.items[0]

        expect(result.toDate).toBe('2026-09-19')
        // Vượt từ 10/9 đến 19/9 = 10 ngày — không cộng thêm ~100 ngày còn lại của năm.
        expect(r.daysOverLimit).toBe(10)
    })
})

describe('Hạn mức so theo ngày lịch', () => {
    it('nâng hạn mức rồi xuất hóa đơn trong cùng một ngày thì không tính là vượt (ca SONHAI)', async () => {
        const { service } = setup({
            customer: customer({ creditLimit: D(20_000) }),
            history: [
                { customerId: 'c1', changedAt: at('2026-08-21', '15:44:29'), oldLimit: D(0), newLimit: D(5_000), tempLimit: null, tempFrom: null, tempTo: null },
                // Sếp duyệt nâng 5 → 20 lúc 15:52 …
                { customerId: 'c1', changedAt: at('2026-09-03', '15:52:20'), oldLimit: D(5_000), newLimit: D(20_000), tempLimit: null, tempFrom: null, tempTo: null },
            ],
            entries: [
                // … rồi 15:55 mới xuất hóa đơn 13.765.
                { type: ReceivableEntryType.OPEN, amountDelta: D(13_765), effectiveAt: at('2026-09-03', '15:55:30') },
                entry(ReceivableEntryType.RECEIPT, -13_765, '2026-09-07'),
            ],
        })

        const result = await service.annualCreditIndicators(2026)
        const r = result.items[0]

        expect(r.daysOverLimit).toBe(0)
        expect(r.annualOverRate).toBe('0')
    })

    it('ngày cuối của đợt hạn mức tạm vẫn được hưởng hạn mức tạm', async () => {
        const { service } = setup({
            customer: customer({ creditLimit: D(1_000) }),
            history: [
                {
                    customerId: 'c1',
                    changedAt: at('2026-08-25'),
                    oldLimit: D(1_000),
                    newLimit: D(1_000),
                    tempLimit: D(3_000),
                    // Cột DATE: Prisma trả về đúng nửa đêm UTC (= 7 giờ sáng giờ VN).
                    tempFrom: new Date('2026-09-01T00:00:00.000Z'),
                    tempTo: new Date('2026-09-10T00:00:00.000Z'),
                },
            ],
            entries: [entry(ReceivableEntryType.OPEN, 2_000, '2026-09-05')],
        })

        const r = await row(service, '2026-09-01', '2026-09-15')

        // Nợ 2.000 từ 5/9: tới hết 10/9 còn trong hạn mức tạm 3.000; vượt từ 11/9 → 15/9 = 5 ngày.
        expect(r.daysOverLimit).toBe(5)
    })
})
