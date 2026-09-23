import { Prisma } from '@prisma/client'
import { ReceivableInterestService } from './receivable-interest.service'

/**
 * Báo cáo lãi bị mất do khách nợ — kiểm bằng chính các ví dụ đã tính tay khi chốt công thức.
 * Công thức: Σ mỗi ngày (dư nợ cuối ngày × lãi suất năm của ngày đó ÷ 365).
 */

const D = (value: number | string) => new Prisma.Decimal(value)
const at = (date: string, time = '10:00:00') => new Date(`${date}T${time}`)
const dateColumn = (date: string) => new Date(`${date}T00:00:00.000Z`)

type Entry = { effectiveAt: Date; amountDelta: Prisma.Decimal }

function setup(options: {
    rates: Array<{ effectiveFrom: string; annualRate: number }>
    items: Array<{ entries: Entry[]; dueDate?: string; customerId?: string }>
}) {
    const prisma = {
        depositInterestRate: {
            findMany: jest.fn(async () =>
                options.rates.map((rate) => ({ effectiveFrom: dateColumn(rate.effectiveFrom), annualRate: D(rate.annualRate) })),
            ),
        },
        receivableOpenItem: {
            findMany: jest.fn(async (args: any) => {
                const to: Date = args.select.entries.where.effectiveAt.lte
                return options.items.map((item, index) => ({
                    id: `item-${index}`,
                    dueDate: item.dueDate ? dateColumn(item.dueDate) : null,
                    note: null,
                    legacyReference: null,
                    installmentNo: 1,
                    customer: { id: item.customerId ?? 'c1', code: 'KH01', name: 'Khách 01' },
                    salesInvoice: { invoiceNoInternal: `HD${index}`, misaInvoiceNo: null },
                    salesOrder: null,
                    withdrawalRequest: null,
                    entries: item.entries.filter((entry) => entry.effectiveAt <= to),
                }))
            }),
        },
    }
    return new ReceivableInterestService(prisma as any)
}

beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })
    jest.setSystemTime(at('2026-12-31', '12:00:00'))
})
afterAll(() => jest.useRealTimers())

describe('Lãi bị mất do khách nợ', () => {
    it('1 tỷ nợ 30 ngày, lãi 5%/năm ≈ 4,11 triệu', async () => {
        const service = setup({
            rates: [{ effectiveFrom: '2026-01-01', annualRate: 5 }],
            items: [
                {
                    entries: [
                        { effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) },
                        // Trả ngày 1/10: số dư cuối các ngày 1/9 → 30/9 là 1 tỷ = đúng 30 ngày.
                        { effectiveAt: at('2026-10-01'), amountDelta: D(-1_000_000_000) },
                    ],
                },
            ],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-10-31' })

        // 1.000.000.000 × 5% × 30 ÷ 365 = 4.109.589,04
        expect(result.totals.lostInterest).toBe('4109589')
        expect(result.items[0].items[0].daysOutstanding).toBe(30)
    })

    it('khách trả dần: tính theo số dư từng ngày, không lấy số nợ ban đầu nhân cả kỳ', async () => {
        const service = setup({
            rates: [{ effectiveFrom: '2026-01-01', annualRate: 5 }],
            items: [
                {
                    entries: [
                        { effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) },
                        { effectiveAt: at('2026-09-11'), amountDelta: D(-600_000_000) },
                        { effectiveAt: at('2026-10-01'), amountDelta: D(-400_000_000) },
                    ],
                },
            ],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-10-31' })

        // 1 tỷ × 10 ngày + 400 triệu × 20 ngày = 18 tỷ·ngày; × 5% ÷ 365 = 2.465.753,42
        expect(result.totals.lostInterest).toBe('2465753')
    })

    it('ngân hàng đổi lãi giữa kỳ: mỗi ngày dùng đúng lãi suất của ngày đó', async () => {
        const service = setup({
            rates: [
                { effectiveFrom: '2026-01-01', annualRate: 5 },
                { effectiveFrom: '2026-09-11', annualRate: 5.5 },
            ],
            items: [
                {
                    entries: [
                        { effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) },
                        { effectiveAt: at('2026-10-01'), amountDelta: D(-1_000_000_000) },
                    ],
                },
            ],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-10-31' })

        // 10 ngày × 5% + 20 ngày × 5,5% = 1 tỷ × (0,5 + 1,1) ÷ 365 = 4.383.561,64
        expect(result.totals.lostInterest).toBe('4383562')
        expect(result.ratesUsed.map((rate) => rate.annualRate)).toEqual(['5', '5.5'])
    })

    it('tách phần lãi mất sau hạn thanh toán (đúng ngày đến hạn chưa tính là trễ)', async () => {
        const service = setup({
            rates: [{ effectiveFrom: '2026-01-01', annualRate: 5 }],
            items: [
                {
                    dueDate: '2026-09-20',
                    entries: [
                        { effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) },
                        { effectiveAt: at('2026-10-01'), amountDelta: D(-1_000_000_000) },
                    ],
                },
            ],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-10-31' })
        const item = result.items[0].items[0]

        // Trễ từ 21/9 → 30/9 = 10 ngày; 1 tỷ × 5% × 10 ÷ 365 = 1.369.863,01
        expect(item.overdueDays).toBe(10)
        expect(item.overdueLostInterest).toBe('1369863')
        expect(item.lostInterest).toBe('4109589')
    })

    it('ngày chưa có lãi suất thì tính 0 và báo ra, không im lặng', async () => {
        const service = setup({
            rates: [{ effectiveFrom: '2026-09-11', annualRate: 5 }],
            items: [
                {
                    entries: [
                        { effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) },
                        { effectiveAt: at('2026-10-01'), amountDelta: D(-1_000_000_000) },
                    ],
                },
            ],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-10-31' })

        expect(result.missingRate).toEqual({ days: 10, fromDate: '2026-09-01', toDate: '2026-09-10' })
        // Chỉ 20 ngày có lãi suất: 1 tỷ × 5% × 20 ÷ 365 = 2.739.726,03
        expect(result.totals.lostInterest).toBe('2739726')
    })

    it('không tính sang những ngày chưa tới', async () => {
        jest.setSystemTime(at('2026-09-10', '12:00:00'))
        const service = setup({
            rates: [{ effectiveFrom: '2026-01-01', annualRate: 5 }],
            items: [{ entries: [{ effectiveAt: at('2026-09-01'), amountDelta: D(1_000_000_000) }] }],
        })

        const result = await service.report({ fromDate: '2026-09-01', toDate: '2026-09-30' })

        expect(result.toDate).toBe('2026-09-10')
        expect(result.items[0].items[0].daysOutstanding).toBe(10)
        jest.setSystemTime(at('2026-12-31', '12:00:00'))
    })
})
