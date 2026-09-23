import { BankTxnDirection, CustomerReceiptStatus } from '@prisma/client'
import { BankCounterpartyRecognizer, coreTokens, type RecognitionInput } from './bank-counterparty-recognizer.service'

/**
 * Mọi nội dung dưới đây chép nguyên văn từ sao kê thật ngày 18/09/2026 (BIDV, MB, Agribank,
 * VCB, VietinBank). Khách hàng là dữ liệu giả, đặt tên đúng như trong danh mục.
 */

const BIDV = 'acc-bidv'
const MB = 'acc-mb'
const VIETIN = 'acc-vietin'

const parties = [
    { id: 'vuongdat', code: 'VUONGDAT', name: 'CT TNHH VAN TAI BIEN VA TM VUONG DAT', taxCode: null },
    { id: 'licoviha', code: 'LICOVIHA', name: 'CÔNG TY TNHH VIỆT ANH LICOVIHA', taxCode: null },
    { id: 'thuyduong', code: 'THUYDUONG', name: 'Công ty Cổ phần Xăng dầu Thủy Dương', taxCode: null },
    { id: 'hxsl', code: 'HXSL', name: 'Công ty TNHH Hoa Xuân Sơn La', taxCode: null },
    { id: 'hoaxuan', code: 'HOAXUAN', name: 'Công ty TNHH Hoa Xuân', taxCode: null },
    { id: 'sonhai', code: 'SONHAI', name: 'Chi nhánh CTCP Dầu khí Sơn Hải tại HN', taxCode: null },
    { id: 'thanhtrung', code: 'THANHTRUNG', name: 'DNTN Thanh Trung', taxCode: null },
    { id: 'honghapt', code: 'HONGHAPT', name: 'Công ty TNHH Vận tải Hồng Hà PT', taxCode: null },
    { id: 'tanbinhan', code: 'TANBINHAN', name: 'Công ty TNHH Xăng dầu Tân Bình An', taxCode: '0200989422' },
    { id: 'daidongxuan', code: 'DAIDONGXUAN', name: 'Công ty CP Đại Đồng Xuân', taxCode: null },
    { id: 'hungyen1', code: 'HY1', name: 'Công ty TNHH Xăng dầu Hưng Yên', taxCode: null },
    { id: 'hungyen2', code: 'HY2', name: 'Công ty CP Thương mại Hưng Yên', taxCode: null },
]

function makeRecognizer(overrides: { partyAccounts?: any[]; receipts?: any[] } = {}) {
    const prisma = {
        bankAccount: {
            findMany: async () => [
                { id: BIDV, accountNo: '5010561429', accountName: 'CONG TY TNHH VAN TAI VA THUONG MAI XANG DAU THIEN PHUC' },
                { id: MB, accountNo: '8401103174008', accountName: 'CONG TY TNHH VAN TAI & TM XANG DAU THIEN PHUC' },
                { id: VIETIN, accountNo: '115002664359', accountName: 'CONG TY TNHH VAN TAI VA THUONG MAI XANG DAU THIEN PHUC' },
            ],
        },
        partyBankAccount: {
            findMany: async () =>
                (overrides.partyAccounts ?? []).map((row) => ({ ...row, party: { ...parties.find((p) => p.id === row.partyId)!, deletedAt: null } })),
        },
        party: { findMany: async () => parties },
        salesEntityAlias: { findMany: async () => [] },
        salesInvoice: {
            findMany: async () => [
                { misaInvoiceNo: '00013033', invoiceNoInternal: 'INV-1', customerPartyId: 'daidongxuan' },
                { misaInvoiceNo: '00013327', invoiceNoInternal: 'INV-2', customerPartyId: 'sonhai' },
            ],
        },
        receivableOpenItem: { findMany: async () => parties.map((party) => ({ customerPartyId: party.id })) },
        customerReceipt: { findMany: async () => overrides.receipts ?? [] },
        purchaseOrder: {
            findMany: async () => [
                {
                    id: 'po-toancau',
                    orderNo: 'TM260900033TOANCAU',
                    supplierCustomerId: 'toancau',
                    supplier: { name: 'CTY DT TC Toàn Cầu' },
                    termPaymentRequests: [
                        {
                            id: 'req-1',
                            requestNo: 'DNTT-0033',
                            status: 'PARTIALLY_PAID',
                            amountVnd: 12_040_007_700,
                            // Đã ghi nhận 11,3 tỷ từ VCB; phần 740tr còn lại chưa ghi nhận.
                            payments: [{ id: 'pay-vcb', amountVnd: 11_300_007_700, paidAt: new Date('2026-09-18'), sourceBankAccountId: 'acc-vcb', reconciliations: [] }],
                        },
                    ],
                },
            ],
        },
        termPaymentBatchItem: { findMany: async () => [] },
    }
    return new BankCounterpartyRecognizer(prisma as any)
}

const row = (overrides: Partial<RecognitionInput>): RecognitionInput => ({
    key: 'r',
    bankAccountId: BIDV,
    direction: BankTxnDirection.IN,
    amount: 100,
    txnDate: new Date('2026-09-18T10:00:00'),
    description: '',
    ...overrides,
})

async function recognizeOne(input: Partial<RecognitionInput>, overrides?: Parameters<typeof makeRecognizer>[0]) {
    const result = await makeRecognizer(overrides).recognize([row(input)])
    return result.get('r')!
}

describe('coreTokens', () => {
    it('bỏ loại hình và ngành nghề, giữ tên riêng', () => {
        expect(coreTokens('CONG TY CO PHAN XANG DAU THUY DUONG')).toEqual(['THUY', 'DUONG'])
        expect(coreTokens('Công ty TNHH Vận tải & TM Hồng Hà PT')).toEqual(['HONG', 'HA', 'PT'])
    })
})

describe('Chuyển nội bộ', () => {
    it('BIDV nhận từ STK MB của công ty', async () => {
        const r = await recognizeOne({ description: 'TKThe :8401103174008, tai MB. CK MB SANG BIDV -CTLNHIDI000016718640948-1/1-CRE-002' })
        expect(r.kind).toBe('INTERNAL')
        expect(r.confidence).toBe('HIGH')
    })

    it('MB chuyển đi: người nhận là công ty mình, tên bị ngân hàng cắt và chèn khoảng trắng', async () => {
        const r = await recognizeOne({
            bankAccountId: MB,
            direction: BankTxnDirection.OUT,
            description: 'MBCT CK MB SANG BIDV D26BXXL9/54229 6',
            counterpartyName: 'CONG TY TNHH VAN TAI THUONG MAI XAN G D',
        })
        expect(r.kind).toBe('INTERNAL')
    })

    it('điều tiền tự động từ một STK chưa khai báo → báo để khai thêm', async () => {
        const r = await recognizeOne({ description: 'Nhan dieu tien tu dong tu 8612515888 - CONG TY TNHH VAN TAI & THUONG MAI XANG DAU THIEN PHUC' })
        expect(r.kind).toBe('INTERNAL')
        expect(r.undeclaredCompanyAccount).toBe('8612515888')
    })

    it('"tra tien Thien Phuc" trong nội dung KHÔNG làm thành chuyển nội bộ', async () => {
        const r = await recognizeOne({ description: 'cty xuan ha tra tien mua hang cho cong ty thien phuc' })
        expect(r.kind).not.toBe('INTERNAL')
    })
})

describe('Nhận diện khách', () => {
    it('BIDV B/O … F/O: tách được tên người chuyển (không lấy nhầm tên công ty mình sau F/O)', async () => {
        const r = await recognizeOne({
            description:
                'REM 9901CI260918000011012 B/O CONG TY TNHH VTB VA TM VUONG DAT F/O-5010561429 CONG TY TNHH VAN TAI VA THUONG MAI XANG DAU THIEN PHUC DTLS-REF/202609182010011000005479317002 TT TIEN HANG CHO HD SO 00012002N14.8.26 Bank',
        })
        // "VTB" là viết tắt của "Vận tải biển" nên chỉ khớp một phần tên → cần người xem.
        expect(r.party?.partyId).toBe('vuongdat')
        expect(r.confidence).toBe('MEDIUM')
    })

    it('BIDV STK--STK--Tên: tách được tên, cắt phần "CHUYEN TIEN…"', async () => {
        const r = await recognizeOne({ description: '8602464999--5010561429--CTY TNHH VIET ANH LICOVIHA CHUYEN TIEN THIEN PHUC' })
        expect(r.payerAccount).toBe('8602464999')
        expect(r.party?.partyId).toBe('licoviha')
        expect(r.confidence).toBe('HIGH')
    })

    it('STK đã lưu cho khách → chắc chắn, kể cả khi nội dung không có tên', async () => {
        const r = await recognizeOne(
            { bankAccountId: VIETIN, description: 'THANH TOAN TIEN HANG', counterpartyAcc: '110623338888' },
            { partyAccounts: [{ accountNo: '110623338888', partyId: 'hxsl' }] },
        )
        expect(r.party?.partyId).toBe('hxsl')
        expect(r.reason).toContain('STK')
    })

    it('MST trong nội dung → chắc chắn', async () => {
        const r = await recognizeOne({
            description: 'REM 9901DP260918000068638 B/O CTY TNHH XANG DAU TAN BINH AN. MST 0200989422. DC TDP PHUC, XA LUU KIEM F/O-5010561429',
        })
        expect(r.party?.partyId).toBe('tanbinhan')
        expect(r.confidence).toBe('HIGH')
    })

    it('Số hóa đơn trong nội dung → ra khách (MB)', async () => {
        const r = await recognizeOne({ bankAccountId: MB, description: 'Thanh toan hoa don so: 00013033', counterpartyName: 'CONG TY CP DAI DONG XUAN' })
        expect(r.party?.partyId).toBe('daidongxuan')
        expect(r.confidence).toBe('HIGH')
    })

    it('MB: tên chính và tên trong ngoặc', async () => {
        const r = await recognizeOne({
            bankAccountId: MB,
            description: 'DNTN TT tra tien xang dau',
            counterpartyName: 'DOANH NGHIEP TU NHAN THANH TRUNG (CUA HANG XANG DAU BO DE)',
        })
        expect(r.party?.partyId).toBe('thanhtrung')
        expect(r.confidence).toBe('HIGH')
    })

    it('VietinBank: cột tên người chuyển', async () => {
        const r = await recognizeOne({
            bankAccountId: VIETIN,
            description: 'hxsl ct xd thien phuc',
            counterpartyName: 'CONG TY TNHH HOA XUAN SON LA',
            counterpartyAcc: '110623338888',
        })
        expect(r.party?.partyId).toBe('hxsl')
        expect(r.confidence).toBe('HIGH')
    })

    it('Chỉ có nội dung tự do → tìm được tên nhưng cần xem lại', async () => {
        const r = await recognizeOne({ bankAccountId: MB, description: 'cpxd thuy duong tra THien Phuc' })
        expect(r.party?.partyId).toBe('thuyduong')
        expect(r.confidence).toBe('MEDIUM')
    })

    it('Viết tắt chữ cái đầu: "HXSL" = Hoa Xuân Sơn La', async () => {
        const r = await recognizeOne({ bankAccountId: VIETIN, description: 'HXSL ct xd thien phuc' })
        expect(r.party?.partyId).toBe('hxsl')
    })

    it('Tên ngắn hơn khớp trọn được ưu tiên hơn tên dài chỉ khớp một phần', async () => {
        const r = await recognizeOne({ bankAccountId: VIETIN, description: 'CTY HOA XUAN CT XD CTY THIEN PHUC' })
        expect(r.party?.partyId).toBe('hoaxuan')
    })

    it('BIDV TKThe: STK + tên, cắt phần "Thanh Toan…"', async () => {
        const r = await recognizeOne({
            description: 'TKThe :290228888888, tai MSCBVNVX. CTY TNHH VAN TAI HONG HA PT Thanh Toan Tien Xang Dau-020097042209181731032026QW8P197390',
        })
        expect(r.payerAccount).toBe('290228888888')
        expect(r.party?.partyId).toBe('honghapt')
    })

    it('Nhiều khách trùng tên → không tự chọn, đưa danh sách để người chọn', async () => {
        const r = await recognizeOne({ bankAccountId: VIETIN, description: 'CT Hung Yen tra tien' })
        expect(r.party).toBeUndefined()
        expect(r.confidence).toBe('LOW')
        expect(r.candidates.map((c) => c.partyId).sort()).toEqual(['hungyen1', 'hungyen2'])
    })

    it('Agribank: mã liên ngân hàng trong cột đối ứng không bị coi là STK', async () => {
        const r = await recognizeOne({ description: 'Cty TNHH TM & VT Hà Sơn TRA THIEN PHUC', counterpartyAcc: '3500ITL261024362' })
        expect(r.payerAccount).toBeNull()
    })

    it('Không có thông tin gì → chọn tay', async () => {
        const r = await recognizeOne({ bankAccountId: VIETIN, description: 'THANH TOAN TIEN HANG' })
        expect(r.kind).toBe('UNKNOWN')
    })
})

describe('Tiền ra theo mã đơn', () => {
    const text = 'CTY THIEN PHUC TT CTY DT TC TOAN CAU THEO DH TM260900033TOANCAU331'

    it('BIDV 740tr: ra NCC, gợi ý ghi nhận chi phần còn lại của đề nghị', async () => {
        const r = await recognizeOne({ direction: BankTxnDirection.OUT, amount: 740_000_000, description: text })
        expect(r.kind).toBe('SUPPLIER')
        expect(r.party?.partyId).toBe('toancau')
        expect(r.paymentMatches?.map((m) => m.type)).toEqual(['COMMERCIAL_REQUEST'])
        expect(r.paymentMatches?.[0].remaining).toBe(740_000_000)
    })

    it('VCB 11,3 tỷ: ghép với lần chi đã ghi nhận từ đúng tài khoản VCB, đứng trước', async () => {
        const r = await recognizeOne({ bankAccountId: 'acc-vcb', direction: BankTxnDirection.OUT, amount: 11_300_007_700, description: 'MBBIZ6082231423.' + text })
        expect(r.paymentMatches?.[0]).toMatchObject({ type: 'COMMERCIAL_PAYMENT', paymentId: 'pay-vcb' })
    })
})

describe('Khoản thu sale đã báo', () => {
    it('ghép với khoản thu cùng khách, cùng số tiền, lệch 1 ngày', async () => {
        const r = await recognizeOne(
            { bankAccountId: MB, amount: 500_000_000, description: 'cpxd thuy duong tra THien Phuc', counterpartyName: 'CONG TY CO PHAN XANG DAU THUY DUONG' },
            {
                receipts: [
                    { id: 'rcp1', customerPartyId: 'thuyduong', amount: 500_000_000, status: CustomerReceiptStatus.REPORTED, receivedAt: new Date('2026-09-17T15:00:00') },
                ],
            },
        )
        expect(r.reportedReceipt?.id).toBe('rcp1')
    })
})
