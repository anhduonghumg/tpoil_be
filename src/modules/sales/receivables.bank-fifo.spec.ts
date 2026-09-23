import { BankTxnDirection, CustomerReceiptStatus, Prisma, ReceivableOpenItemStatus } from '@prisma/client'
import { ReceivablesService } from './receivables.service'

/**
 * Ghi nhận tiền về theo FIFO (màn Thu tiền) không được trừ chéo pháp nhân: tiền vào tài khoản
 * pháp nhân A chỉ trừ nợ của pháp nhân A — cùng quy tắc với phân bổ tay (allocateBankReceipt).
 */

const D = (value: number) => new Prisma.Decimal(value)
const A = 'le-a'
const B = 'le-b'

function openItem(id: string, legalEntityId: string, outstanding: number, dueDate: string) {
    return {
        id,
        legalEntityId,
        customerPartyId: 'cust',
        currency: 'VND',
        settlementType: 'RECEIVABLE',
        status: ReceivableOpenItemStatus.OPEN,
        outstandingAmount: D(outstanding),
        dueDate: new Date(dueDate),
        createdAt: new Date(dueDate),
    }
}

function makeService(options: { accountLegalEntityId: string | null; items: ReturnType<typeof openItem>[]; reportedReceipt?: any }) {
    const allocations: { openItemId: string; amount: Prisma.Decimal }[] = []
    const bankUpdates: any[] = []
    const tx: any = {
        $executeRaw: async () => 0,
        bankTransaction: {
            findUnique: async () => ({
                id: 'bt1',
                direction: BankTxnDirection.IN,
                amount: D(100),
                txnDate: new Date('2026-09-18T10:00:00'),
                reconciliationStatus: 'PENDING',
                externalRef: 'REF1',
                counterpartyAcc: null,
                counterpartyName: null,
                bankAccount: { currency: 'VND', legalEntityId: options.accountLegalEntityId },
                receivableAllocations: [],
                customerReceipt: null,
            }),
            update: async (args: any) => bankUpdates.push(args.data),
        },
        party: { findUnique: async () => ({ id: 'cust', name: 'Khách' }) },
        customerReceipt: {
            create: async (args: any) => ({ id: 'rcp-new', ...args.data }),
            update: async () => ({}),
            findUnique: async () => options.reportedReceipt ?? null,
        },
        receivableOpenItem: {
            // Lọc đúng như Prisma: có legalEntityId trong điều kiện thì chỉ lấy pháp nhân đó.
            findMany: async (args: any) =>
                options.items
                    .filter((item) => !args.where.legalEntityId || item.legalEntityId === args.where.legalEntityId)
                    .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
            update: async () => ({}),
        },
        receivableAllocation: {
            create: async (args: any) => {
                allocations.push({ openItemId: args.data.openItemId, amount: args.data.amountInItemCurrency })
                return { id: `alloc-${allocations.length}` }
            },
            updateMany: async () => ({ count: 0 }),
        },
        receivableLedgerEntry: { create: async () => ({}) },
        partyBankAccount: { upsert: async () => ({}) },
    }
    const prisma: any = { $transaction: async (fn: (tx: any) => Promise<unknown>) => fn(tx) }
    const service = new ReceivablesService(prisma, {} as any)
    const actor = { userId: 'u1', permissions: [], scopes: [] } as any
    const post = () => service.postBankReceiptsFifo({ items: [{ bankTransactionId: 'bt1', customerPartyId: 'cust' }] }, actor)
    return { post, allocations, bankUpdates, service, actor }
}

describe('Ghi nhận tiền về theo FIFO — pháp nhân', () => {
    it('tiền vào tài khoản pháp nhân A chỉ trừ nợ pháp nhân A, kể cả khi nợ B đến hạn sớm hơn', async () => {
        const { post, allocations } = makeService({
            accountLegalEntityId: A,
            items: [openItem('b-old', B, 80, '2026-09-01'), openItem('a-1', A, 60, '2026-09-10'), openItem('a-2', A, 60, '2026-09-15')],
        })
        const result = await post()
        expect(result.results[0].ok).toBe(true)
        expect(allocations.map((row) => row.openItemId)).toEqual(['a-1', 'a-2'])
        expect(allocations.map((row) => Number(row.amount))).toEqual([60, 40])
    })

    it('nợ pháp nhân A không đủ thì phần dư giữ lại, không tràn sang pháp nhân B', async () => {
        const { post, allocations, bankUpdates } = makeService({
            accountLegalEntityId: A,
            items: [openItem('a-1', A, 30, '2026-09-10'), openItem('b-1', B, 500, '2026-09-11')],
        })
        const result = await post()
        expect(allocations.map((row) => row.openItemId)).toEqual(['a-1'])
        expect(result.results[0].unappliedAmount).toBe('70')
        expect(bankUpdates[0].reconciliationStatus).toBe('PARTIALLY_ALLOCATED')
    })

    it('tài khoản chưa khai pháp nhân + khách nợ ở 2 pháp nhân → dừng, báo khai pháp nhân', async () => {
        const { post, allocations } = makeService({
            accountLegalEntityId: null,
            items: [openItem('a-1', A, 60, '2026-09-10'), openItem('b-1', B, 60, '2026-09-11')],
        })
        const result = await post()
        expect(result.results[0].ok).toBe(false)
        expect(result.results[0].message).toContain('pháp nhân')
        expect(allocations).toHaveLength(0)
    })

    it('tài khoản chưa khai pháp nhân nhưng khách chỉ nợ ở 1 pháp nhân → vẫn ghi nhận được', async () => {
        const { post, allocations } = makeService({
            accountLegalEntityId: null,
            items: [openItem('a-1', A, 60, '2026-09-10'), openItem('a-2', A, 60, '2026-09-11')],
        })
        const result = await post()
        expect(result.results[0].ok).toBe(true)
        expect(allocations).toHaveLength(2)
    })

    it('khoản sale đã báo và đã trừ nợ pháp nhân B không ghép được vào tiền về tài khoản pháp nhân A', async () => {
        const { service, actor } = makeService({
            accountLegalEntityId: A,
            items: [],
            reportedReceipt: {
                id: 'rcp1',
                customerPartyId: 'cust',
                bankTransactionId: null,
                currency: 'VND',
                amount: D(100),
                status: CustomerReceiptStatus.CONFIRMED,
                collectionPlanId: null,
                allocations: [{ amountInBankCurrency: D(100), openItem: { legalEntityId: B } }],
            },
        })
        const result = await service.postBankReceiptsFifo(
            { items: [{ bankTransactionId: 'bt1', customerPartyId: 'cust', customerReceiptId: 'rcp1' }] },
            actor,
        )
        expect(result.results[0].ok).toBe(false)
        expect(result.results[0].message).toContain('pháp nhân khác')
    })
})
