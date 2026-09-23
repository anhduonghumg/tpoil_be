import { Injectable } from '@nestjs/common'
import {
    BankTxnDirection,
    CustomerReceiptStatus,
    PaymentFundingSource,
    SalesAliasEntityType,
    TermPaymentBatchFileType,
    TermPaymentBatchItemStatus,
    TermPaymentRequestStatus,
} from '@prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'

/*
 * Nhận diện đối tượng của một dòng sao kê: khách nào trả, hay là chuyển nội bộ / phí ngân hàng.
 *
 * Dựng từ 5 file sao kê thật (BIDV, MB, Agribank, VCB, VietinBank). Mỗi ngân hàng để thông tin
 * người chuyển một kiểu:
 *   - VietinBank, MB có cột tên người chuyển; VietinBank, Agribank có cột STK đối ứng.
 *   - BIDV nhét tất cả vào mô tả: "REM … B/O <tên> F/O-<STK mình> …", "<STK>--<STK mình>--<tên> …",
 *     "TKThe :<STK>, tai MB. …", "Nhan dieu tien tu dong tu <STK> - <tên>".
 *   - VCB chỉ có mô tả, kèm tiền tố kênh "IBVCB.<số>." hoặc "MBBIZ<số>.".
 *
 * Kết quả chỉ là ĐỀ XUẤT: không ghi gì vào DB. Công nợ chỉ giảm khi kế toán bấm ghi nhận.
 */

export type RecognitionKind = 'CUSTOMER' | 'SUPPLIER' | 'INTERNAL' | 'BANK_FEE' | 'UNKNOWN'
/** HIGH: căn cứ chắc chắn (STK, MST, số HĐ, tên do ngân hàng ghi). MEDIUM: tìm thấy tên trong nội dung. */
export type RecognitionConfidence = 'HIGH' | 'MEDIUM' | 'LOW'

export type RecognitionParty = { partyId: string; partyCode: string; partyName: string; reason: string }

/** Hồ sơ chi có thể ghép với một dòng tiền ra, tìm theo mã đơn trong nội dung chuyển khoản. */
export type PaymentMatch =
    | {
          type: 'COMMERCIAL_PAYMENT'
          /** Lần chi Mua TM đã ghi nhận, cùng tài khoản nguồn, còn phần chưa ghép sao kê. */
          paymentId: string
          requestNo: string
          orderNo: string
          supplierName: string
          remaining: number
          paidAt: Date
      }
    | {
          type: 'COMMERCIAL_REQUEST'
          /** Đề nghị Mua TM đã kiểm tra, chưa ai ghi nhận chi: ghi nhận luôn từ dòng sao kê. */
          paymentRequestId: string
          requestNo: string
          orderNo: string
          supplierName: string
          remaining: number
      }
    | {
          type: 'TERM_BATCH_ITEM'
          batchId: string
          batchNo: string
          itemId: string
          orderNo: string
          supplierName: string
          remaining: number
          hasUnc: boolean
      }

export type Recognition = {
    kind: RecognitionKind
    /** Chỉ có ở tiền ra: hồ sơ chi khớp theo mã đơn, số tiền khớp đứng trước. */
    paymentMatches?: PaymentMatch[]
    confidence: RecognitionConfidence
    reason: string
    party?: RecognitionParty
    /** Các khách có thể là, khi chưa đủ chắc để chọn một. */
    candidates: RecognitionParty[]
    payerName: string | null
    payerAccount: string | null
    /** STK có vẻ là của công ty (dòng chuyển nội bộ) nhưng chưa khai ở Tài khoản công ty. */
    undeclaredCompanyAccount?: string
    /** Khoản thu sale đã báo trước: cùng khách, cùng số tiền, chưa ghép sao kê. */
    reportedReceipt?: { id: string; status: CustomerReceiptStatus; receivedAt: Date }
}

export type RecognitionInput = {
    key: string
    bankAccountId: string
    direction: BankTxnDirection
    amount: number
    txnDate: Date
    description: string
    counterpartyName?: string | null
    counterpartyAcc?: string | null
}

type PartyRow = { id: string; code: string; name: string; taxCode: string | null }
type PartyIndex = PartyRow & { tokens: string[]; compact: string; initials: string }

/* Từ chỉ loại hình doanh nghiệp: bỏ đi thì mới còn phần tên riêng để so. */
const LEGAL_PHRASES = [
    'TONG CONG TY', 'CONG TY', 'CTY', 'CT', 'CHI NHANH', 'CN', 'TNHH', 'MTV', 'MOT THANH VIEN', 'CO PHAN', 'CP', 'CTCP',
    'DOANH NGHIEP TU NHAN', 'DNTN', 'DOANH NGHIEP', 'DN', 'TAP DOAN', 'HOP TAC XA', 'HTX', 'CUA HANG', 'CHXD',
]
/* Từ chỉ ngành nghề: gần như khách nào cũng có, không giúp phân biệt. */
const GENERIC_PHRASES = [
    'THUONG MAI', 'TM', 'VAN TAI', 'VT', 'XANG DAU', 'XD', 'DAU KHI', 'DICH VU', 'DV', 'XUAT NHAP KHAU', 'XNK', 'DAU TU',
    'PHAT TRIEN', 'SAN XUAT', 'SX', 'KINH DOANH', 'TONG HOP', 'NHIEN LIEU', 'VA', 'AND', 'TAI', 'CPXD', 'TMDV', 'TMVT',
]
/* Từ hay gặp trong nội dung chuyển khoản mà gần như không nằm trong tên ai. Cố ý không có
   THANH, HOA, HANG… vì đó là tên riêng thật (Thanh Trung, Hoa Xuân, Hằng Hải). */
const NOISE_WORDS = new Set(['TT', 'TRA', 'TIEN', 'CHO', 'CHUYEN', 'KHOAN', 'CK', 'MUA', 'NGAY', 'THEO', 'SO', 'HD', 'PAY', 'TO', 'FOR', 'FUELS', 'REM', 'BANK', 'THANG', 'NOP'])
/* Tên tách từ nội dung BIDV hay dính phần lý do phía sau: "VIET ANH LICOVIHA CHUYEN TIEN…". */
const PAYER_NAME_STOP = /\s(?:CHUYEN|TT|TRA|NOP|CK|THANH TOAN|THANHTOAN|PAYMENT)\b.*$/
/* Viết tắt trong tên công ty mình, để "CTY … TM …" và "CONG TY … THUONG MAI …" so được với nhau. */
const OWN_NAME_EXPAND: Record<string, string> = { CTY: 'CONGTY', CT: 'CONGTY', TM: 'THUONGMAI', VT: 'VANTAI', XD: 'XANGDAU', VA: '' }
const FEE_PATTERN = /^(THU )?PHI\b|\bPHI (DICH VU|QUAN LY|SMS|CHUYEN|DUY TRI|THUONG NIEN)\b|\bLAI TIEN GUI\b|\bTRA LAI TIEN GUI\b|\bLAI NHAP (VON|GOC)\b|\bINTEREST\b|\bSMS BANKING\b/

export function plainText(value: unknown) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toUpperCase()
        .replace(/[^A-Z0-9/\-.,:&()]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
}

const wordsOf = (value: string) => plainText(value).replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean)

function stripPhrases(tokens: string[], phrases: string[]) {
    const lists = phrases.map((phrase) => phrase.split(' ')).sort((a, b) => b.length - a.length)
    const out: string[] = []
    for (let index = 0; index < tokens.length; ) {
        const hit = lists.find((words) => words.every((word, offset) => tokens[index + offset] === word))
        if (hit) index += hit.length
        else out.push(tokens[index++])
    }
    return out
}

/** Phần tên riêng của một tên công ty: "CONG TY CO PHAN XANG DAU THUY DUONG" → [THUY, DUONG]. */
export function coreTokens(name: string) {
    // "TM" viết tắt, "&" → cùng dạng với bản viết đủ.
    const tokens = wordsOf(String(name).replace(/&/g, ' VA '))
    return stripPhrases(stripPhrases(tokens, LEGAL_PHRASES), GENERIC_PHRASES)
}

const digitsOnly = (value: unknown) => String(value ?? '').replace(/\D/g, '')

/** Tên viết liền đã quy về một dạng, dùng để nhận ra tên công ty mình dù ngân hàng cắt ngắn. */
const canonicalCompact = (name: string) =>
    wordsOf(name.replace(/&/g, ' VA '))
        .map((word) => OWN_NAME_EXPAND[word] ?? word)
        .join('')

/** "DNTN THANH TRUNG (CUA HANG XANG DAU BO DE)" → ["DNTN THANH TRUNG", "CUA HANG XANG DAU BO DE"]. */
const nameVariants = (name: string) => {
    const inside = [...name.matchAll(/\(([^)]+)\)/g)].map((match) => match[1].trim())
    const outside = name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim()
    return [outside, ...inside].filter(Boolean)
}

@Injectable()
export class BankCounterpartyRecognizer {
    constructor(private readonly prisma: PrismaService) {}

    async recognize(inputs: RecognitionInput[]): Promise<Map<string, Recognition>> {
        const result = new Map<string, Recognition>()
        if (!inputs.length) return result

        const ctx = await this.loadContext(inputs)
        for (const input of inputs) result.set(input.key, this.recognizeOne(input, ctx))
        await this.attachReportedReceipts(inputs, result)
        return result
    }

    private async loadContext(inputs: RecognitionInput[]) {
        const texts = inputs.map((input) => plainText(`${input.description} ${input.counterpartyName ?? ''}`))
        const invoiceNos = [...new Set(texts.flatMap((text) => this.extractInvoiceNos(text)))]
        const taxCodes = [...new Set(texts.flatMap((text) => [...text.matchAll(/\bMST\s*:?\s*(\d{10}(?:-\d{3})?)/g)].map((m) => m[1])))]

        const [companyAccounts, partyAccounts, parties, aliases, invoices, receivableParties] = await Promise.all([
            this.prisma.bankAccount.findMany({ select: { id: true, accountNo: true, accountName: true } }),
            this.prisma.partyBankAccount.findMany({
                where: { isActive: true },
                select: { accountNo: true, partyId: true, party: { select: { id: true, code: true, name: true, deletedAt: true } } },
            }),
            this.prisma.party.findMany({ where: { deletedAt: null }, select: { id: true, code: true, name: true, taxCode: true } }),
            this.prisma.salesEntityAlias.findMany({
                where: { entityType: SalesAliasEntityType.PARTY, validTo: null, partyId: { not: null } },
                select: { normalizedName: true, partyId: true },
            }),
            invoiceNos.length
                ? this.prisma.salesInvoice.findMany({
                      where: { OR: [{ misaInvoiceNo: { in: invoiceNos.flatMap((no) => [no, no.replace(/^0+/, '')]) } }, { invoiceNoInternal: { in: invoiceNos } }] },
                      select: { misaInvoiceNo: true, invoiceNoInternal: true, customerPartyId: true },
                  })
                : Promise.resolve([]),
            this.prisma.receivableOpenItem.findMany({ distinct: ['customerPartyId'], select: { customerPartyId: true } }),
        ])

        const partyById = new Map(parties.map((party) => [party.id, party]))
        const companyAccountNos = new Map(companyAccounts.map((account) => [digitsOnly(account.accountNo), account.id]))
        // Tên công ty mình lấy từ tên chủ các tài khoản công ty.
        const ownNames = [...new Set(companyAccounts.map((account) => account.accountName).filter(Boolean) as string[])].map((name) => ({
            compact: canonicalCompact(name),
            core: coreTokens(name),
        }))

        const accountToParties = new Map<string, Set<string>>()
        for (const row of partyAccounts) {
            if (row.party.deletedAt) continue
            const key = digitsOnly(row.accountNo)
            if (!key) continue
            accountToParties.set(key, (accountToParties.get(key) ?? new Set()).add(row.partyId))
        }

        const invoiceToParty = new Map<string, Set<string>>()
        for (const invoice of invoices) {
            for (const no of [invoice.misaInvoiceNo, invoice.invoiceNoInternal]) {
                if (!no) continue
                const key = no.replace(/^0+/, '')
                invoiceToParty.set(key, (invoiceToParty.get(key) ?? new Set()).add(invoice.customerPartyId))
            }
        }

        const customerIds = new Set(receivableParties.map((row) => row.customerPartyId))
        const indexed: PartyIndex[] = parties
            .map((party) => {
                const tokens = coreTokens(party.name)
                return { ...party, tokens, compact: tokens.join(''), initials: tokens.map((token) => token[0]).join('') }
            })
            .filter((party) => party.compact.length >= 2)

        const aliasToParties = new Map<string, Set<string>>()
        for (const alias of aliases) {
            if (!alias.partyId || alias.normalizedName.length < 3) continue
            aliasToParties.set(alias.normalizedName, (aliasToParties.get(alias.normalizedName) ?? new Set()).add(alias.partyId))
        }

        const orderMatches = await this.loadOrderMatches(inputs, texts)

        return { partyById, companyAccountNos, ownNames, accountToParties, invoiceToParty, customerIds, indexed, aliasToParties, taxCodes, orderMatches }
    }

    /** Mã đơn trong nội dung: "…THEO DH TM260900033TOANCAU331" → đầu mã "TM260900033". */
    private extractOrderPrefixes(text: string) {
        return [...new Set([...text.matchAll(/\b(T[EM])\s?(\d{6,12})/g)].map((match) => `${match[1]}${match[2]}`))]
    }

    /** Hồ sơ chi của các đơn nhắc tới trong nội dung tiền ra, gom theo đầu mã đơn. */
    private async loadOrderMatches(inputs: RecognitionInput[], texts: string[]) {
        const prefixes = [
            ...new Set(inputs.flatMap((input, index) => (input.direction === BankTxnDirection.OUT ? this.extractOrderPrefixes(texts[index]) : []))),
        ].slice(0, 200)
        const byPrefix = new Map<string, { supplierPartyId: string; supplierName: string; orderNo: string; commercial: any[]; term: any[] }[]>()
        if (!prefixes.length) return byPrefix

        const orders = await this.prisma.purchaseOrder.findMany({
            where: { OR: prefixes.map((prefix) => ({ orderNo: { startsWith: prefix } })) },
            select: {
                id: true,
                orderNo: true,
                supplierCustomerId: true,
                supplier: { select: { name: true } },
                termPaymentRequests: {
                    where: {
                        supplierInvoiceId: { not: null },
                        status: { in: [TermPaymentRequestStatus.BANK_VERIFIED, TermPaymentRequestStatus.PARTIALLY_PAID, TermPaymentRequestStatus.PAID] },
                    },
                    select: {
                        id: true,
                        requestNo: true,
                        status: true,
                        amountVnd: true,
                        payments: {
                            where: { fundingSource: PaymentFundingSource.OWN_BANK },
                            select: {
                                id: true,
                                amountVnd: true,
                                paidAt: true,
                                sourceBankAccountId: true,
                                reconciliations: { where: { reversedAt: null }, select: { amountVnd: true } },
                            },
                        },
                    },
                },
            },
        })
        const termItems = orders.length
            ? await this.prisma.termPaymentBatchItem.findMany({
                  where: {
                      purchaseOrderId: { in: orders.map((order) => order.id) },
                      bankTransactionId: null,
                      status: { notIn: [TermPaymentBatchItemStatus.PAID, TermPaymentBatchItemStatus.CANCELLED, TermPaymentBatchItemStatus.FAILED] },
                  },
                  select: {
                      id: true,
                      purchaseOrderId: true,
                      amountVnd: true,
                      supplierName: true,
                      batch: { select: { id: true, batchNo: true, files: { where: { fileType: TermPaymentBatchFileType.UNC }, select: { id: true } } } },
                  },
              })
            : []

        for (const order of orders) {
            const prefix = prefixes.find((value) => order.orderNo.startsWith(value))
            if (!prefix) continue
            const list = byPrefix.get(prefix) ?? []
            list.push({
                supplierPartyId: order.supplierCustomerId,
                supplierName: order.supplier.name,
                orderNo: order.orderNo,
                commercial: order.termPaymentRequests,
                term: termItems.filter((item) => item.purchaseOrderId === order.id),
            })
            byPrefix.set(prefix, list)
        }
        return byPrefix
    }

    private paymentMatchesFor(input: RecognitionInput, text: string, ctx: Awaited<ReturnType<BankCounterpartyRecognizer['loadContext']>>) {
        const matches: PaymentMatch[] = []
        let supplier: { partyId: string; name: string } | null = null
        let orderNo: string | null = null
        for (const prefix of this.extractOrderPrefixes(text)) {
            for (const order of ctx.orderMatches.get(prefix) ?? []) {
                supplier ??= { partyId: order.supplierPartyId, name: order.supplierName }
                orderNo ??= order.orderNo
                for (const request of order.commercial) {
                    const paid = request.payments.reduce((sum: number, payment: any) => sum + Number(payment.amountVnd), 0)
                    for (const payment of request.payments) {
                        if (payment.sourceBankAccountId !== input.bankAccountId) continue
                        const reconciled = payment.reconciliations.reduce((sum: number, row: any) => sum + Number(row.amountVnd), 0)
                        const remaining = Number(payment.amountVnd) - reconciled
                        if (remaining > 0.5) {
                            matches.push({ type: 'COMMERCIAL_PAYMENT', paymentId: payment.id, requestNo: request.requestNo, orderNo: order.orderNo, supplierName: order.supplierName, remaining, paidAt: payment.paidAt })
                        }
                    }
                    const requestRemaining = Number(request.amountVnd) - paid
                    if (requestRemaining > 0.5 && request.status !== TermPaymentRequestStatus.PAID) {
                        matches.push({ type: 'COMMERCIAL_REQUEST', paymentRequestId: request.id, requestNo: request.requestNo, orderNo: order.orderNo, supplierName: order.supplierName, remaining: requestRemaining })
                    }
                }
                for (const item of order.term) {
                    matches.push({
                        type: 'TERM_BATCH_ITEM',
                        batchId: item.batch.id,
                        batchNo: item.batch.batchNo,
                        itemId: item.id,
                        orderNo: order.orderNo,
                        supplierName: item.supplierName || order.supplierName,
                        remaining: Number(item.amountVnd),
                        hasUnc: item.batch.files.length > 0,
                    })
                }
            }
        }
        // Khớp đúng số tiền lên trước; lần chi đã ghi nhận trước đề nghị chưa ghi nhận.
        const rank = { COMMERCIAL_PAYMENT: 0, TERM_BATCH_ITEM: 1, COMMERCIAL_REQUEST: 2 } as const
        matches.sort((a, b) => {
            const exactA = Math.abs(a.remaining - input.amount) < 0.5 ? 0 : 1
            const exactB = Math.abs(b.remaining - input.amount) < 0.5 ? 0 : 1
            return exactA - exactB || rank[a.type] - rank[b.type]
        })
        return { matches, supplier, orderNo }
    }

    private extractInvoiceNos(text: string) {
        const found: string[] = []
        for (const match of text.matchAll(/\b(?:HD|HOA DON)\s*(?:SO|NO)?\s*:?\s*(\d{3,8}(?:\s*[,;]\s*\d{3,8})*)/g)) {
            for (const no of match[1].split(/[,;]/)) found.push(no.trim().replace(/^0+/, ''))
        }
        return found.filter((no) => no.length >= 3)
    }

    /** Tách tên và STK người chuyển từ các mẫu nội dung của từng ngân hàng. */
    private extractPayer(input: RecognitionInput) {
        const text = plainText(input.description)
        let payerName = input.counterpartyName?.trim() || null
        // Chỉ nhận là STK khi ô toàn chữ số: Agribank có ô kiểu "3500ITL261024362" là mã liên
        // ngân hàng, bỏ chữ đi sẽ ra một "STK" không có thật.
        const rawAccount = String(input.counterpartyAcc ?? '').trim()
        let payerAccount = /^[\d\s.-]{6,}$/.test(rawAccount) && digitsOnly(rawAccount).length >= 6 ? digitsOnly(rawAccount) : null

        const bo = /\bB\/O\s+(.+?)(?:\.\s*MST\b|\s+F\/O\b|$)/.exec(text)
        const dashed = /^(\d{6,20})--(\d{6,20})--(.+)$/.exec(text)
        const card = /\bTKTHE\s*:\s*(\d{6,20})\s*,\s*TAI\s+[A-Z0-9]+\s*\.\s*(.*)$/.exec(text)
        const sweep = /\bTU\s+(\d{6,20})\s*-\s*(.+)$/.exec(text)
        const cut = (value?: string | null) => (value ? value.replace(PAYER_NAME_STOP, '').trim() || null : null)
        if (dashed) {
            payerAccount ??= dashed[1]
            payerName ??= cut(dashed[3])
        } else if (card) {
            payerAccount ??= card[1]
            payerName ??= cut(card[2])
        } else if (sweep) {
            payerAccount ??= sweep[1]
            payerName ??= cut(sweep[2])
        } else if (bo) {
            payerName ??= cut(bo[1])
        }
        return { text, payerName, payerAccount, fromBankColumn: Boolean(input.counterpartyName?.trim()) || Boolean(bo || dashed) }
    }

    private isOwnName(name: string, ownNames: { compact: string }[]) {
        const compact = canonicalCompact(name)
        // Đủ dài mới so: "CONG TY TNHH VAN TAI" thôi thì khách nào cũng có thể bắt đầu như vậy.
        if (compact.length < 24) return false
        // MB cắt tên và chèn khoảng trắng ("…XAN G D"), nên so theo đầu chuỗi đã bỏ hết khoảng trắng.
        return ownNames.some((own) => own.compact.startsWith(compact) || compact.startsWith(own.compact))
    }

    private recognizeOne(input: RecognitionInput, ctx: Awaited<ReturnType<BankCounterpartyRecognizer['loadContext']>>): Recognition {
        const { text, payerName, payerAccount, fromBankColumn } = this.extractPayer(input)
        const partyKind: RecognitionKind = input.direction === BankTxnDirection.IN ? 'CUSTOMER' : 'SUPPLIER'
        const base = { payerName, payerAccount, candidates: [] as RecognitionParty[] }
        const toParty = (id: string, reason: string): RecognitionParty | null => {
            const party = ctx.partyById.get(id)
            return party ? { partyId: party.id, partyCode: party.code, partyName: party.name, reason } : null
        }
        const ownAccountOfRow = [...ctx.companyAccountNos.entries()].find(([, id]) => id === input.bankAccountId)?.[0]

        // 1) Chuyển nội bộ: STK đối ứng là của công ty, hoặc người chuyển/nhận chính là công ty mình.
        if (payerAccount && payerAccount !== ownAccountOfRow && ctx.companyAccountNos.has(payerAccount)) {
            return { ...base, kind: 'INTERNAL', confidence: 'HIGH', reason: `STK ${payerAccount} là tài khoản công ty` }
        }
        if (payerName && this.isOwnName(payerName, ctx.ownNames)) {
            const undeclared = payerAccount && !ctx.companyAccountNos.has(payerAccount) ? payerAccount : undefined
            return {
                ...base,
                kind: 'INTERNAL',
                confidence: 'HIGH',
                reason: 'Đối tác là chính công ty mình',
                ...(undeclared ? { undeclaredCompanyAccount: undeclared } : {}),
            }
        }

        // 2) Phí, lãi ngân hàng.
        if (FEE_PATTERN.test(text)) return { ...base, kind: 'BANK_FEE', confidence: 'HIGH', reason: 'Nội dung là phí / lãi ngân hàng' }

        // 2b) Tiền ra nhắc mã đơn mua: ra luôn NCC và hồ sơ chi để ghép.
        if (input.direction === BankTxnDirection.OUT) {
            const { matches, supplier, orderNo } = this.paymentMatchesFor(input, text, ctx)
            if (supplier && orderNo) {
                const party = toParty(supplier.partyId, `Mã đơn ${orderNo}`) ?? {
                    partyId: supplier.partyId,
                    partyCode: '',
                    partyName: supplier.name,
                    reason: `Mã đơn ${orderNo}`,
                }
                return { ...base, kind: 'SUPPLIER', confidence: 'HIGH', reason: party.reason, party, paymentMatches: matches }
            }
        }

        // 3) STK người chuyển đã lưu cho một đối tác.
        const accountHits = payerAccount ? ctx.accountToParties.get(payerAccount) : undefined
        if (accountHits?.size === 1) {
            const party = toParty([...accountHits][0], `STK ${payerAccount} đã lưu cho đối tác`)
            if (party) return { ...base, kind: partyKind, confidence: 'HIGH', reason: party.reason, party }
        }

        // 4) Mã số thuế trong nội dung.
        const taxCode = /\bMST\s*:?\s*(\d{10}(?:-\d{3})?)/.exec(text)?.[1]
        if (taxCode) {
            const hit = [...ctx.partyById.values()].filter((party) => party.taxCode && digitsOnly(party.taxCode) === digitsOnly(taxCode))
            if (hit.length === 1) {
                const party = toParty(hit[0].id, `MST ${taxCode}`)!
                return { ...base, kind: partyKind, confidence: 'HIGH', reason: party.reason, party }
            }
        }

        // 5) Số hóa đơn bán hàng trong nội dung (chỉ để biết KHÁCH là ai; công nợ vẫn trừ theo FIFO).
        if (input.direction === BankTxnDirection.IN) {
            const invoiceParties = new Set<string>()
            const matchedNos: string[] = []
            for (const no of this.extractInvoiceNos(text)) {
                const hits = ctx.invoiceToParty.get(no)
                if (hits) {
                    hits.forEach((id) => invoiceParties.add(id))
                    matchedNos.push(no)
                }
            }
            if (invoiceParties.size === 1) {
                const party = toParty([...invoiceParties][0], `Hóa đơn ${matchedNos.join(', ')}`)
                if (party) return { ...base, kind: partyKind, confidence: 'HIGH', reason: party.reason, party }
            }
        }

        // 6) Theo tên.
        const scored = this.scoreByName(text, payerName, ctx)
        const preferCustomers = (list: typeof scored) =>
            input.direction === BankTxnDirection.IN && list.some((item) => ctx.customerIds.has(item.id))
                ? list.filter((item) => ctx.customerIds.has(item.id))
                : list
        const ranked = preferCustomers(scored)
        const candidates = ranked.slice(0, 5).map((item) => toParty(item.id, item.reason)).filter(Boolean) as RecognitionParty[]
        if (ranked.length) {
            const [best, second] = ranked
            const clearWinner = !second || best.score - second.score >= 1
            if (clearWinner) {
                const party = toParty(best.id, best.reason)!
                // Tên do ngân hàng ghi (cột người chuyển, B/O…) khớp trọn → chắc chắn; tìm thấy
                // trong nội dung người gõ tự do → cần người xem lại.
                const confidence: RecognitionConfidence = best.exactName && fromBankColumn ? 'HIGH' : 'MEDIUM'
                return { ...base, kind: partyKind, confidence, reason: party.reason, party, candidates }
            }
            return { ...base, kind: partyKind, confidence: 'LOW', reason: 'Nhiều đối tác trùng tên', candidates }
        }
        if (accountHits && accountHits.size > 1) {
            return {
                ...base,
                kind: partyKind,
                confidence: 'LOW',
                reason: `STK ${payerAccount} đang lưu cho nhiều đối tác`,
                candidates: [...accountHits].map((id) => toParty(id, 'Cùng STK')).filter(Boolean) as RecognitionParty[],
            }
        }
        return { ...base, kind: 'UNKNOWN', confidence: 'LOW', reason: 'Không có căn cứ nhận diện' }
    }

    /**
     * Chấm điểm theo tên: so phần tên riêng của đối tác với tên người chuyển và nội dung.
     * Bỏ phần tên công ty mình khỏi nội dung trước, vì gần như dòng nào cũng "…tra tien Thien Phuc".
     */
    private scoreByName(text: string, payerName: string | null, ctx: Awaited<ReturnType<BankCounterpartyRecognizer['loadContext']>>) {
        const ownCore = ctx.ownNames.map((own) => own.core).filter((core) => core.length)
        const clean = (value: string) => {
            let tokens = wordsOf(value.replace(/&/g, ' VA '))
            for (const core of ownCore) {
                // Bỏ cụm tên riêng của công ty mình (vd. THIEN PHUC) ở bất kỳ đâu trong câu.
                const out: string[] = []
                for (let index = 0; index < tokens.length; ) {
                    if (core.every((word, offset) => tokens[index + offset] === word)) index += core.length
                    else out.push(tokens[index++])
                }
                tokens = out
            }
            return tokens
        }
        const payerCompacts = payerName ? nameVariants(payerName).map((variant) => coreTokens(variant).join('')).filter((value) => value.length >= 2) : []
        const payerCompact = payerCompacts[0] ?? ''
        const textTokens = clean(`${payerName ?? ''} ${text}`).filter((token) => !NOISE_WORDS.has(token))
        const windows = new Set<string>()
        for (let size = 1; size <= 5; size += 1) {
            for (let index = 0; index + size <= textTokens.length; index += 1) windows.add(textTokens.slice(index, index + size).join(''))
        }

        const scores = new Map<string, { id: string; score: number; reason: string; exactName: boolean }>()
        const bump = (id: string, score: number, reason: string, exactName = false) => {
            const current = scores.get(id)
            if (!current || score > current.score) scores.set(id, { id, score, reason, exactName: exactName || Boolean(current?.exactName) })
        }

        for (const party of ctx.indexed) {
            // Tên người chuyển do ngân hàng ghi trùng phần tên riêng của đối tác.
            if (payerCompacts.includes(party.compact)) bump(party.id, 10, `Tên người chuyển: ${payerName}`, true)
            else if (
                payerCompacts.some(
                    (compact) => compact.length >= 8 && party.compact.length >= 6 && (party.compact.startsWith(compact) || compact.startsWith(party.compact)),
                )
            ) {
                bump(party.id, 8, `Tên người chuyển gần khớp: ${payerName}`)
            }
            // Phần tên riêng xuất hiện liền trong nội dung ("cpxd THUY DUONG tra…").
            if (party.tokens.length >= 2 && windows.has(party.compact)) bump(party.id, 6 + Math.min(party.tokens.length, 3), `Nội dung có "${party.tokens.join(' ')}"`)
            else if (party.tokens.length === 1 && party.compact.length >= 5 && windows.has(party.compact)) bump(party.id, 5, `Nội dung có "${party.compact}"`)
            else if (party.tokens.length >= 3) {
                // Chỉ khớp một phần: lấy đoạn liền dài nhất (≥ 2 từ) của tên trong nội dung.
                for (let size = party.tokens.length - 1; size >= 2; size -= 1) {
                    const hit = [...Array(party.tokens.length - size + 1).keys()].some((start) => windows.has(party.tokens.slice(start, start + size).join('')))
                    if (hit) {
                        bump(party.id, 3 + size, `Nội dung có một phần tên "${party.tokens.join(' ')}"`)
                        break
                    }
                }
            }
            // Viết tắt chữ cái đầu ("HXSL" = Hoa Xuân Sơn La).
            if (party.initials.length >= 3 && windows.has(party.initials)) bump(party.id, 5, `Viết tắt "${party.initials}"`)
        }

        // Bí danh do kinh doanh khai báo.
        for (const [alias, partyIds] of ctx.aliasToParties) {
            const exact = payerCompacts.includes(alias)
            if (alias.length >= 4 && (windows.has(alias) || exact)) {
                for (const id of partyIds) bump(id, exact ? 10 : 7, `Bí danh "${alias}"`, exact)
            }
        }

        return [...scores.values()].sort((a, b) => b.score - a.score)
    }

    /** Khoản thu sale đã báo: cùng khách, cùng số tiền, trong ±3 ngày, chưa ghép sao kê. */
    private async attachReportedReceipts(inputs: RecognitionInput[], result: Map<string, Recognition>) {
        const wanted = inputs.filter((input) => input.direction === BankTxnDirection.IN && result.get(input.key)?.party)
        if (!wanted.length) return
        const partyIds = [...new Set(wanted.map((input) => result.get(input.key)!.party!.partyId))]
        const dates = wanted.map((input) => input.txnDate.getTime())
        const receipts = await this.prisma.customerReceipt.findMany({
            where: {
                customerPartyId: { in: partyIds },
                bankTransactionId: null,
                status: { in: [CustomerReceiptStatus.REPORTED, CustomerReceiptStatus.CONFIRMED] },
                receivedAt: { gte: new Date(Math.min(...dates) - 3 * 86_400_000), lte: new Date(Math.max(...dates) + 3 * 86_400_000) },
            },
            select: { id: true, customerPartyId: true, amount: true, status: true, receivedAt: true },
        })
        const used = new Set<string>()
        for (const input of wanted) {
            const recognition = result.get(input.key)!
            const hit = receipts.find(
                (receipt) =>
                    !used.has(receipt.id) &&
                    receipt.customerPartyId === recognition.party!.partyId &&
                    Math.abs(Number(receipt.amount) - input.amount) < 0.5 &&
                    Math.abs(receipt.receivedAt.getTime() - input.txnDate.getTime()) <= 3 * 86_400_000,
            )
            if (hit) {
                used.add(hit.id)
                recognition.reportedReceipt = { id: hit.id, status: hit.status, receivedAt: hit.receivedAt }
            }
        }
    }
}
