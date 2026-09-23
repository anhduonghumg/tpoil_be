import {
    BankTxnDirection,
    CollectionPlanStatus,
    CustomerReceiptStatus,
    Prisma,
    ReceivableAllocationStatus,
    ReceivableEntryType,
    ReceivableOpenItemStatus,
} from '@prisma/client'
import { ReceivablesService } from './receivables.service'

/**
 * Đảo khoản thu phải đồng bộ cả vòng: công nợ, khoản thu, dòng sao kê, kế hoạch thu — và
 * cho kế toán ghi nhận lại. Ví dụ thật: dòng VietinBank 18/09 "CTY HOA XUAN CT XD" 295tr bị
 * ghi nhầm vào Hoa Xuân Sơn La, 25/09 mới phát hiện.
 */

const D = (value: number) => new Prisma.Decimal(value)
const day = (value: string) => new Date(`${value}T10:00:00`)

/** DB trong bộ nhớ, đủ cho các lệnh Prisma mà luồng ghi nhận / đảo dùng tới. */
function makeDb() {
    let seq = 0
    const id = (prefix: string) => `${prefix}-${++seq}`
    const db = {
        bankTransaction: [
            {
                id: 'bt1',
                direction: BankTxnDirection.IN,
                amount: D(295),
                txnDate: day('2026-09-18'),
                reconciliationStatus: 'PENDING',
                matchStatus: 'UNMATCHED',
                isConfirmed: false,
                externalRef: '1GeDq',
                counterpartyAcc: '115002627587',
                counterpartyName: 'CONG TY TNHH HOA XUAN',
                counterpartyType: null as string | null,
                counterpartyId: null as string | null,
                bankAccountId: 'acc-vietin',
            },
        ] as any[],
        openItem: [
            { id: 'oi-hxsl', customerPartyId: 'hxsl', legalEntityId: 'le', currency: 'VND', settlementType: 'RECEIVABLE', status: ReceivableOpenItemStatus.OPEN, originalAmount: D(400), outstandingAmount: D(400), dueDate: day('2026-09-10'), createdAt: day('2026-09-01'), salesOrderId: 'so1', withdrawalRequestId: null },
            { id: 'oi-hx', customerPartyId: 'hoaxuan', legalEntityId: 'le', currency: 'VND', settlementType: 'RECEIVABLE', status: ReceivableOpenItemStatus.OPEN, originalAmount: D(295), outstandingAmount: D(295), dueDate: day('2026-09-12'), createdAt: day('2026-09-02'), salesOrderId: 'so2', withdrawalRequestId: null },
        ] as any[],
        receipt: [] as any[],
        allocation: [] as any[],
        ledger: [] as any[],
        plan: [{ id: 'plan-hxsl', status: CollectionPlanStatus.ACTIVE, plannedAmount: D(295), completedAt: null }] as any[],
        partyAccount: [] as any[],
    }
    const activeAllocations = (where: (row: any) => boolean) => db.allocation.filter((row) => row.status === ReceivableAllocationStatus.ACTIVE && where(row))
    const withOpenItem = (row: any) => ({ ...row, openItem: db.openItem.find((item) => item.id === row.openItemId) })
    const patch = (list: any[], where: { id: string }, data: any) => {
        const row = list.find((item) => item.id === where.id)
        Object.assign(row, data)
        return row
    }

    const tx: any = {
        $executeRaw: async () => 0,
        bankTransaction: {
            findUnique: async ({ where, select }: any) => {
                const row = db.bankTransaction.find((item) => item.id === where.id)
                if (!row) return null
                const customerReceipt = db.receipt.find((item) => item.bankTransactionId === row.id) ?? null
                if (select) return { id: row.id, customerReceipt: customerReceipt && { id: customerReceipt.id } }
                return {
                    ...row,
                    bankAccount: { currency: 'VND', legalEntityId: 'le' },
                    receivableAllocations: activeAllocations((item) => item.bankTransactionId === row.id),
                    customerReceipt: customerReceipt && { id: customerReceipt.id },
                }
            },
            findUniqueOrThrow: async ({ where }: any) => {
                const row = db.bankTransaction.find((item) => item.id === where.id)
                const customerReceipt = db.receipt.find((item) => item.bankTransactionId === row.id) ?? null
                return { amount: row.amount, customerReceipt: customerReceipt && { id: customerReceipt.id } }
            },
            update: async ({ where, data }: any) => patch(db.bankTransaction, where, data),
        },
        party: { findUnique: async ({ where }: any) => ({ id: where.id, name: where.id }) },
        customerReceipt: {
            create: async ({ data }: any) => {
                const row = { id: id('rcp'), status: CustomerReceiptStatus.REPORTED, collectionPlanId: null, note: null, bankTransactionId: null, ...data }
                db.receipt.push(row)
                return row
            },
            update: async ({ where, data }: any) => patch(db.receipt, where, data),
            findUnique: async ({ where }: any) => {
                const row = db.receipt.find((item) => item.id === where.id)
                return row && { ...row, allocations: activeAllocations((item) => item.customerReceiptId === row.id).map(withOpenItem) }
            },
        },
        receivableOpenItem: {
            findMany: async ({ where }: any) =>
                db.openItem
                    .filter((item) => item.customerPartyId === where.customerPartyId && where.status.in.includes(item.status) && (!where.legalEntityId || item.legalEntityId === where.legalEntityId))
                    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
            findUniqueOrThrow: async ({ where }: any) => db.openItem.find((item) => item.id === where.id),
            update: async ({ where, data }: any) => {
                const { version: _version, ...rest } = data
                return patch(db.openItem, where, rest)
            },
        },
        receivableAllocation: {
            create: async ({ data }: any) => {
                if (db.allocation.some((row) => row.idempotencyKey === data.idempotencyKey)) throw new Error(`UNIQUE idempotencyKey ${data.idempotencyKey}`)
                const row = { id: id('alloc'), status: ReceivableAllocationStatus.ACTIVE, customerReceiptId: null, bankTransactionId: null, fxRate: D(1), ...data }
                db.allocation.push(row)
                return row
            },
            update: async ({ where, data }: any) => patch(db.allocation, where, data),
            findUnique: async ({ where }: any) => {
                const row = db.allocation.find((item) => item.id === where.id)
                return row ? withOpenItem(row) : null
            },
            findMany: async ({ where }: any) => activeAllocations((row) => row.bankTransactionId === where.bankTransactionId).map(withOpenItem),
            aggregate: async ({ where }: any) => ({
                _sum: {
                    amountInBankCurrency: activeAllocations((row) => row.bankTransactionId === where.bankTransactionId).reduce((sum, row) => sum.plus(row.amountInBankCurrency), D(0)),
                },
            }),
            updateMany: async () => ({ count: 0 }),
        },
        receivableLedgerEntry: {
            create: async ({ data }: any) => {
                const row = { id: id('le'), ...data }
                db.ledger.push(row)
                return row
            },
            findFirst: async ({ where }: any) => db.ledger.find((row) => row.allocationId === where.allocationId) ?? null,
        },
        customerCollectionPlan: {
            findUnique: async ({ where }: any) => {
                const plan = db.plan.find((item) => item.id === where.id)
                return plan && { ...plan, receipts: db.receipt.filter((row) => row.collectionPlanId === plan.id).map((row) => ({ amount: row.amount, status: row.status })) }
            },
            update: async ({ where, data }: any) => patch(db.plan, where, data),
        },
        partyBankAccount: { upsert: async ({ create }: any) => db.partyAccount.push(create) },
    }
    const prisma: any = { ...tx, $transaction: async (fn: (client: any) => Promise<unknown>) => fn(tx) }
    const events = { record: async () => undefined }
    const service = new ReceivablesService(prisma, events as any)
    const actor = { userId: 'ketoan', permissions: [], scopes: [] } as any
    return { db, service, actor }
}

const outstanding = (db: ReturnType<typeof makeDb>['db'], id: string) => Number(db.openItem.find((item) => item.id === id).outstandingAmount)

describe('Đảo khoản thu — đồng bộ cả vòng', () => {
    it('ghi nhầm khách → đảo → dòng sao kê về hàng đợi → ghi nhận lại đúng khách', async () => {
        const { db, service, actor } = makeDb()

        // 18/09: ghi nhầm vào Hoa Xuân Sơn La, gắn với kế hoạch thu của khách đó.
        const first = await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        expect(first.results[0].ok).toBe(true)
        const wrongReceipt = db.receipt[0]
        wrongReceipt.collectionPlanId = 'plan-hxsl'
        db.plan[0].status = CollectionPlanStatus.COMPLETED
        expect(outstanding(db, 'oi-hxsl')).toBe(105)

        // 25/09: đảo, lý do ghi nhầm khách.
        await service.reverseBankReceipt('bt1', { reason: 'Ghi nhầm khách', mode: 'CORRECTION' }, actor)

        expect(outstanding(db, 'oi-hxsl')).toBe(400) // 1. công nợ trả lại
        expect(wrongReceipt.status).toBe(CustomerReceiptStatus.REVERSED) // 2. khoản thu REVERSED
        expect(wrongReceipt.bankTransactionId).toBeNull()
        expect(wrongReceipt.note).toContain('Ghi nhầm khách')
        expect(db.bankTransaction[0]).toMatchObject({ reconciliationStatus: 'PENDING', matchStatus: 'UNMATCHED', isConfirmed: false }) // 3. dòng sao kê về hàng đợi
        expect(db.plan[0].status).toBe(CollectionPlanStatus.ACTIVE) // 4. kế hoạch thu mở lại

        // 5. Ghi nhận lại cho đúng khách Hoa Xuân.
        const again = await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hoaxuan' }] }, actor)
        expect(again.results[0].ok).toBe(true)
        expect(outstanding(db, 'oi-hx')).toBe(0)
        expect(db.bankTransaction[0].reconciliationStatus).toBe('ALLOCATED')
    })

    it('sửa sai (CORRECTION): bút đảo lấy đúng ngày bút gốc, sổ như chưa ghi nhầm', async () => {
        const { db, service, actor } = makeDb()
        await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        await service.reverseBankReceipt('bt1', { mode: 'CORRECTION' }, actor)
        const reversal = db.ledger.find((row) => row.type === ReceivableEntryType.REVERSAL)
        expect(reversal.effectiveAt).toEqual(day('2026-09-18'))
    })

    it('ngân hàng hoàn trả (BANK_REVERSAL): bút đảo lấy ngày thực hiện đảo', async () => {
        const { db, service, actor } = makeDb()
        await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        const before = Date.now()
        await service.reverseBankReceipt('bt1', { mode: 'BANK_REVERSAL' }, actor)
        const reversal = db.ledger.find((row) => row.type === ReceivableEntryType.REVERSAL)
        expect(reversal.effectiveAt.getTime()).toBeGreaterThanOrEqual(before)
    })

    it('đảo lẻ một bút của khoản thu FIFO thì đảo cả khoản thu', async () => {
        const { db, service, actor } = makeDb()
        // Khách có 2 khoản nợ nhỏ để FIFO trải ra 2 bút.
        db.openItem[0].outstandingAmount = D(200)
        db.openItem[0].originalAmount = D(200)
        db.openItem.push({ ...db.openItem[0], id: 'oi-hxsl-2', dueDate: day('2026-09-11'), outstandingAmount: D(200), originalAmount: D(200) })
        await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        const firstAllocation = db.allocation.find((row) => row.status === ReceivableAllocationStatus.ACTIVE)
        jest.spyOn(service, 'detail').mockResolvedValue({} as any)

        await service.reverseAllocation(firstAllocation.id, actor, { reason: 'Sai' })

        expect(db.allocation.filter((row) => row.status === ReceivableAllocationStatus.ACTIVE)).toHaveLength(0)
        expect(db.receipt[0].status).toBe(CustomerReceiptStatus.REVERSED)
        expect(outstanding(db, 'oi-hxsl') + outstanding(db, 'oi-hxsl-2')).toBe(400)
    })

    it('đảo xong khóa chống trùng được giải phóng — ghi lại cùng khoá không bị coi là đã xử lý', async () => {
        const { db, service, actor } = makeDb()
        await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        const key = db.allocation[0].idempotencyKey
        await service.reverseBankReceipt('bt1', {}, actor)
        expect(db.allocation[0].idempotencyKey).toBe(`${key}#reversed`)
    })

    it('đảo hai lần báo lỗi rõ ràng', async () => {
        const { service, actor } = makeDb()
        await service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'hxsl' }] }, actor)
        await service.reverseBankReceipt('bt1', {}, actor)
        await expect(service.reverseBankReceipt('bt1', {}, actor)).rejects.toThrow()
    })
})
