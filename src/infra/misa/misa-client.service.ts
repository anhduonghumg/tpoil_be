import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { randomUUID } from 'crypto'
import { amountInWords } from './amount-in-words'

export type MisaInvoiceLine = {
    lineNo: number
    /** Nhãn thuế đóng băng lúc dựng hóa đơn; null thì suy từ taxRate. */
    taxRateName?: string | null
    description: string
    uom: string
    qty: string
    unitPrice: string
    discountAmount: string
    taxRate: string | null
    netAmount: string
    taxAmount: string
    lineTotal: string
}

export type MisaPublishRequest = {
    /** Our internal invoice number — MISA's transaction key, stable across retries. */
    transactionId: string
    invoiceDate: string
    buyerName: string
    buyerTaxCode?: string | null
    buyerAddress?: string | null
    buyerEmail?: string | null
    currency: string
    subtotal: string
    discountTotal: string
    taxTotal: string
    grandTotal: string
    lines: MisaInvoiceLine[]
}

export type MisaPublishResult = {
    ok: boolean
    /** Present when MISA accepted the invoice. */
    invoiceNo?: string
    /** Mã giao dịch DO MISA sinh (khác RefID của mình) — cần khi làm việc với hỗ trợ MISA. */
    misaTransactionId?: string
    templateNo?: string
    serial?: string
    transactionId?: string
    errorCode?: string
    errorMessage?: string
    httpStatus?: number
    raw?: unknown
}

export type MisaStatusResult = {
    /** Whether MISA already holds a published invoice for this transaction key. */
    published: boolean
    invoiceNo?: string
    templateNo?: string
    serial?: string
    raw?: unknown
}

/** MISA error codes that a later attempt can still succeed on (see meInvoice docs). */
const RETRYABLE_ERROR_CODES = new Set(['InvoiceDuplicated', 'InvoiceNumberNotContinuous'])

export function isRetryableMisaError(errorCode?: string | null) {
    return !!errorCode && RETRYABLE_ERROR_CODES.has(errorCode)
}

/** MISA wraps every payload as a JSON *string* inside the envelope; unwrap defensively. */
function parseEmbedded<T>(value: unknown): T | null {
    if (value == null) return null
    if (typeof value !== 'string') return value as T
    try {
        return JSON.parse(value) as T
    } catch {
        return null
    }
}

/**
 * Nhãn thuế suất MISA chấp nhận — đúng danh sách trong ô chọn của meInvoice.
 * KCT = không chịu thuế, KKKNT = không kê khai nộp thuế.
 */
const MISA_VAT_RATE_NAMES: readonly string[] = ['0%', '5%', '8%', '10%']
const MISA_VAT_SPECIAL_NAMES: readonly string[] = ['KCT', 'KKKNT']

/**
 * MISA nhận thuế suất theo NHÃN chứ không theo số, và chỉ nhận đúng sáu nhãn trên. Thuế
 * suất ngoài danh sách (7%, 2%, 7,5%…) bị từ chối — mà bảng thuế của mình cho nhập bất
 * kỳ số nào từ 0 đến 100, nên chặn ngay tại đây với câu đọc được, thay vì để hóa đơn đi
 * tới MISA rồi nhận về một mã lỗi không ai luận ra.
 */
export function vatRateName(rate: string | number | null | undefined) {
    if (rate == null || rate === '') return 'KCT'
    // Cho phép truyền thẳng nhãn đặc biệt, vì hai trường hợp này không quy ra số được.
    if (typeof rate === 'string') {
        const label = rate.trim().toUpperCase()
        if (MISA_VAT_SPECIAL_NAMES.includes(label)) return label
    }
    const fraction = Number(rate)
    if (!Number.isFinite(fraction)) return 'KCT'
    const name = `${Number((fraction * 100).toFixed(4))}%`
    if (!MISA_VAT_RATE_NAMES.includes(name)) {
        throw new BadRequestException({
            code: 'MISA_VAT_RATE_UNSUPPORTED',
            message: `Thuế suất ${name} không phát hành được: MISA chỉ nhận ${MISA_VAT_RATE_NAMES.join(', ')}, KCT hoặc KKKNT.`,
        })
    }
    return name
}

export type MisaConfig = {
    baseUrl: string
    taxCode: string
    username: string
    password: string
    appId: string
    templateNo: string
    serial: string
    signType: number
    paymentMethod: string
    publishMinGapMs: number
    mock: boolean
    /** Cấu hình đang lấy từ đâu — để màn cấu hình nói rõ với người dùng. */
    source: 'DATABASE' | 'ENV'
    /** Môi trường của dòng đang dùng; ENV thì suy từ địa chỉ API. */
    environment: 'TEST' | 'PRODUCTION'
}

/**
 * MISA meInvoice output-invoice API.
 *
 * Contract verified against the sandbox (testapi.meinvoice.vn/api/integration):
 * - `POST /auth/token` → `{ success, data: "<JWT>", errorCode, descriptionErrorCode }`;
 *   the JWT carries its own `exp`, so the cache honours the real lifetime.
 * - `POST /invoice` → `{ success, createInvoiceResult, publishInvoiceResult }`, both of
 *   which are JSON *strings* holding one result object per RefID.
 * - `POST /invoice/status` takes a bare array of RefIDs.
 * - `GET /invoice/templates` lists the registered templates and series.
 *
 * Two vendor rules shape the client: the bearer is long lived and must NOT be re-fetched per
 * request, and publishing is serial per invoice series with a short pause between calls.
 *
 * With no credentials (or MISA_MOCK=1) it runs in mock mode so the sales flow stays testable;
 * mock mode never pretends a real invoice reached an external system.
 */
@Injectable()
export class MisaClientService {
    private readonly logger = new Logger(MisaClientService.name)
    private token: { value: string; expiresAt: number } | null = null
    /** Cấu hình đọc từ DB, nhớ tạm để không truy vấn lại ở mỗi dòng hóa đơn. */
    private cachedConfig: { value: MisaConfig; at: number } | null = null
    private static readonly CONFIG_TTL_MS = 30_000

    /** Mock-mode ledger so a "did this already publish?" query behaves like the real thing. */
    private readonly mockPublished = new Map<string, MisaStatusResult>()
    private lastPublishAt = 0

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Cấu hình lấy từ bảng InvoiceProviderConfig; chưa có dòng nào thì lùi về biến môi
     * trường, để hệ thống đang chạy không đứt trước khi ai đó bấm lưu lần đầu.
     */
    async config(): Promise<MisaConfig> {
        const now = Date.now()
        if (this.cachedConfig && now - this.cachedConfig.at < MisaClientService.CONFIG_TTL_MS) {
            return this.cachedConfig.value
        }

        // Đúng một dòng active; chưa có dòng nào thì lùi về biến môi trường.
        const row = await this.prisma.invoiceProviderConfig.findFirst({ where: { active: true } })
        const value: MisaConfig = row
            ? {
                  baseUrl: row.baseUrl.replace(/\/+$/, ''),
                  taxCode: row.taxCode,
                  username: row.username,
                  password: row.password,
                  appId: row.appId,
                  templateNo: row.templateNo,
                  serial: row.serial,
                  signType: row.signType,
                  paymentMethod: row.paymentMethod,
                  publishMinGapMs: row.publishMinGapMs,
                  // Thiếu thông tin kết nối thì buộc phải giả lập, không gọi mù ra ngoài.
                  mock: row.mock || !row.baseUrl || !row.appId,
                  source: 'DATABASE',
                  environment: row.environment,
              }
            : {
                  baseUrl: (process.env.MISA_BASE_URL ?? '').replace(/\/+$/, ''),
                  taxCode: process.env.MISA_TAX_CODE ?? '',
                  username: process.env.MISA_USERNAME ?? '',
                  password: process.env.MISA_PASSWORD ?? '',
                  appId: process.env.MISA_APP_ID ?? '',
                  templateNo: process.env.MISA_TEMPLATE_NO ?? '1/001',
                  serial: process.env.MISA_SERIAL ?? 'C25MOCK',
                  signType: Number(process.env.MISA_SIGN_TYPE ?? 1),
                  paymentMethod: process.env.MISA_PAYMENT_METHOD ?? 'TM/CK',
                  publishMinGapMs: Number(process.env.MISA_PUBLISH_MIN_GAP_MS ?? 3000),
                  mock:
                      process.env.MISA_MOCK === '1' ||
                      !process.env.MISA_BASE_URL ||
                      !process.env.MISA_APP_ID,
                  source: 'ENV',
                  environment: (process.env.MISA_BASE_URL ?? '').includes('testapi.')
                      ? 'TEST'
                      : 'PRODUCTION',
              }

        this.cachedConfig = { value, at: now }
        return value
    }

    /** Gọi ngay sau khi lưu cấu hình để lần dùng kế tiếp đọc lại từ DB. */
    invalidateConfigCache() {
        this.cachedConfig = null
        this.token = null
    }

    /** Secrets must never reach the issuance log. */
    maskPayload(payload: unknown): unknown {
        if (!payload || typeof payload !== 'object') return payload
        const masked: Record<string, unknown> = { ...(payload as Record<string, unknown>) }
        for (const key of Object.keys(masked)) {
            if (/password|secret|token|appid|api_?key/i.test(key)) masked[key] = '***'
        }
        return masked
    }

    /**
     * MISA answers HTML from maintenance.misa.vn (HTTP 503) while the service is down.
     * Treat that as a transient outage rather than letting a JSON parse error surface.
     */
    private assertNotMaintenance(status: number, bodyText: string) {
        if (status === 503 || bodyText.trimStart().startsWith('<')) {
            throw new ServiceUnavailableException({
                code: 'MISA_UNAVAILABLE',
                message: 'Hệ thống MISA đang bảo trì hoặc không phản hồi, vui lòng thử lại sau.',
                httpStatus: status,
            })
        }
    }

    /**
     * POST {BaseURL}/auth/token → { Success, Data: <token>, ErrorCode, Errors }.
     * The bearer is long lived (MISA documents ~14 days) and the vendor asks that it be
     * fetched only at session start, so it is cached here rather than per request.
     */
    private async authenticate(cfg: MisaConfig): Promise<string> {
        if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value

        const response = await fetch(`${cfg.baseUrl}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appid: cfg.appId,
                taxcode: cfg.taxCode,
                username: cfg.username,
                password: cfg.password,
            }),
        })
        const text = await response.text()
        this.assertNotMaintenance(response.status, text)

        let body: {
            success?: boolean
            data?: string
            errorCode?: string
            descriptionErrorCode?: string
        } | null = null
        try {
            body = JSON.parse(text)
        } catch {
            throw new ServiceUnavailableException({
                code: 'MISA_AUTH_INVALID_RESPONSE',
                message: 'Phản hồi token MISA không phải JSON hợp lệ.',
            })
        }
        if (!response.ok || body?.success === false || !body?.data) {
            throw new ServiceUnavailableException({
                code: 'MISA_AUTH_FAILED',
                message: `Không lấy được token MISA (HTTP ${response.status}, mã ${body?.errorCode ?? 'N/A'}).`,
            })
        }

        // The token is a JWT: take the expiry it actually carries instead of guessing.
        this.token = { value: body.data, expiresAt: this.jwtExpiry(body.data) }
        return body.data
    }

    private jwtExpiry(jwt: string) {
        const fallback = Date.now() + Number(process.env.MISA_TOKEN_TTL_SECONDS ?? 12 * 60 * 60) * 1000
        try {
            const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()) as {
                exp?: number
            }
            return claims.exp ? claims.exp * 1000 : fallback
        } catch {
            return fallback
        }
    }

    private async call(cfg: MisaConfig, path: string, payload: unknown) {
        const token = await this.authenticate(cfg)
        const response = await fetch(`${cfg.baseUrl}${path}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
        })
        const text = await response.text()
        this.assertNotMaintenance(response.status, text)
        let raw: unknown = null
        try {
            raw = JSON.parse(text)
        } catch {
            raw = { rawText: text.slice(0, 500) }
        }
        return { httpStatus: response.status, ok: response.ok, raw }
    }

    /** MISA asks for at least ~3s between consecutive publishes on the same series. */
    private async respectPublishSpacing(cfg: MisaConfig) {
        const minGapMs = cfg.publishMinGapMs
        const waitMs = this.lastPublishAt + minGapMs - Date.now()
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
        this.lastPublishAt = Date.now()
    }

    /** Dựng khối InvoiceData dùng chung cho cả lập nháp lẫn phát hành. */
    private buildInvoicePayload(cfg: MisaConfig, request: MisaPublishRequest) {
        // MISA wants each money field twice: OC = original currency, plain = base currency.
        // Only VND is in scope today (exchange rate 1), so the two are equal.
        const numeric = (value: string) => Number(value)
        // Tiền hàng sau chiết khấu, gộp từ chính các dòng — không lấy subtotal trừ đi
        // discountTotal, để đầu hóa đơn luôn khớp đúng tổng các dòng bên dưới.
        const netTotal = request.lines.reduce((sum, line) => sum + numeric(line.netAmount), 0)
        const invoice = {
            RefID: request.transactionId,
            InvTemplateNo: cfg.templateNo,
            InvSeries: cfg.serial,
            // Tài liệu tích hợp nhận ngày trần "YYYY-MM-DD"; đính thêm giờ là thừa và
            // dễ bị đọc lệch một ngày.
            InvDate: request.invoiceDate,
            CurrencyCode: request.currency,
            ExchangeRate: 1,
            PaymentMethodName: cfg.paymentMethod,
            BuyerLegalName: request.buyerName,
            BuyerTaxCode: request.buyerTaxCode ?? '',
            BuyerAddress: request.buyerAddress ?? '',
            BuyerEmail: request.buyerEmail ?? '',
            // Hóa đơn KHÔNG thể hiện chiết khấu: đơn giá đưa lên MISA đã là giá sau chiết
            // khấu, nên tiền hàng bằng luôn tiền sau chiết khấu và dòng chiết khấu bằng 0.
            // Tổng thanh toán không đổi, chỉ khác cách trình bày trên tờ hóa đơn.
            TotalSaleAmount: netTotal,
            TotalSaleAmountOC: netTotal,
            TotalDiscountAmount: 0,
            TotalDiscountAmountOC: 0,
            TotalAmountWithoutVAT: netTotal,
            TotalAmountWithoutVATOC: netTotal,
            TotalVATAmount: numeric(request.taxTotal),
            TotalVATAmountOC: numeric(request.taxTotal),
            TotalAmount: numeric(request.grandTotal),
            TotalAmountOC: numeric(request.grandTotal),
            // MISA in nguyên văn dòng chữ này lên hóa đơn, nên mình phải tự dựng.
            TotalAmountInWords: amountInWords(request.grandTotal),
            // Per-rate summary block; MISA rejects the invoice without it.
            TaxRateInfo: this.taxRateSummary(request.lines),
            OriginalInvoiceDetail: request.lines.map((line) => {
                const qty = numeric(line.qty)
                const net = numeric(line.netAmount)
                const tax = numeric(line.taxAmount)
                /*
                 * Đơn giá đưa lên MISA là giá ĐÃ TRỪ chiết khấu, suy ngược từ thành tiền:
                 * netAmount = qty × (đơn giá gốc − chiết khấu mỗi đơn vị), nên net / qty trả
                 * lại đúng đơn giá sau chiết khấu. Làm tròn 8 chữ số đúng bằng độ chính xác
                 * cột unitPrice trong CSDL, tránh sai số dấu phẩy động làm lệch
                 * Quantity × UnitPrice so với Amount và bị MISA từ chối.
                 */
                const netUnitPrice = qty === 0 ? 0 : Number((net / qty).toFixed(8))
                return {
                    LineNumber: line.lineNo,
                    SortOrder: line.lineNo,
                    ItemType: 1,
                    ItemName: line.description,
                    UnitName: line.uom,
                    Quantity: qty,
                    UnitPrice: netUnitPrice,
                    UnitPriceOC: netUnitPrice,
                    Amount: net,
                    AmountOC: net,
                    AmountWithoutVAT: net,
                    AmountWithoutVATOC: net,
                    // Chiết khấu đã nằm trong đơn giá, không hiện thành dòng riêng.
                    DiscountRate: 0,
                    DiscountAmount: 0,
                    DiscountAmountOC: 0,
                    VATRateName: line.taxRateName ?? vatRateName(line.taxRate),
                    VATAmount: tax,
                    VATAmountOC: tax,
                    TotalAmount: net + tax,
                    TotalAmountOC: net + tax,
                }
            }),
        }

        return invoice
    }


    async publish(request: MisaPublishRequest): Promise<MisaPublishResult> {
        const cfg = await this.config()
        if (cfg.mock) {
            const result: MisaStatusResult = {
                published: true,
                invoiceNo: `MOCK-${request.transactionId}`,
                templateNo: cfg.templateNo,
                serial: cfg.serial,
            }
            this.mockPublished.set(request.transactionId, result)
            this.logger.debug(`MISA mock publish ${request.transactionId}`)
            return {
                ok: true,
                invoiceNo: result.invoiceNo,
                templateNo: result.templateNo,
                serial: result.serial,
                transactionId: request.transactionId,
                raw: { mock: true },
            }
        }

        await this.respectPublishSpacing(cfg)

        /*
         * MỘT lệnh duy nhất, `PublishInvoiceData` để null — đây là hình dạng đã kiểm chứng
         * chạy được trên sandbox.
         *
         * Quyết định phát hành hay không nằm ở SignType, KHÔNG phải ở khối PublishInvoiceData:
         *  - SignType 1: MISA chỉ lập XML để ký bằng USB token tại máy → publishInvoiceResult
         *    trả null, hóa đơn không bao giờ ra.
         *  - SignType 2: MISA ký và phát hành ngay, kết quả nằm trong publishInvoiceResult.
         *
         * Từng thử tách thành hai lệnh (lập rồi phát hành riêng): lệnh phát hành luôn bị từ
         * chối `InvoiceTemplateNotExist` với mọi SignType và mọi cách truyền mẫu số/ký hiệu.
         */
        const response = await this.call(cfg, '/invoice', {
            SignType: cfg.signType,
            InvoiceData: [this.buildInvoicePayload(cfg, request)],
            PublishInvoiceData: null,
        })
        return this.readInvoiceResult(cfg, response, request.transactionId, 'publish')
    }

    /**
     * Bóc kết quả của `POST /invoice`. Vỏ ngoài có thể `success` trong khi từng hóa đơn
     * bên trong lại hỏng, nên phải soi cả hai khối kết quả.
     */
    private readInvoiceResult(
        cfg: MisaConfig,
        response: { httpStatus?: number; ok: boolean; raw: unknown },
        transactionId: string,
        kind: 'draft' | 'publish',
    ): MisaPublishResult {
        const { httpStatus, ok, raw } = response
        const body = raw as
            | {
                  success?: boolean
                  errorCode?: string
                  descriptionErrorCode?: string
                  createInvoiceResult?: unknown
                  publishInvoiceResult?: unknown
              }
            | null

        const rejectMessage =
            kind === 'draft'
                ? 'MISA từ chối lập hóa đơn nháp.'
                : 'MISA từ chối phát hành hóa đơn.'

        if (!ok || body?.success === false) {
            return {
                ok: false,
                errorCode: body?.errorCode ?? `HTTP_${httpStatus}`,
                errorMessage: body?.descriptionErrorCode ?? rejectMessage,
                httpStatus,
                raw,
            }
        }

        type MisaResultItem = {
            RefID?: string
            TransactionID?: string
            InvNo?: string
            InvTemplateNo?: string
            InvSeries?: string
            Success?: boolean
            ErrorCode?: string
            DescriptionErrorCode?: string
        }
        const created = parseEmbedded<MisaResultItem[]>(body?.createInvoiceResult)?.[0]
        const published = parseEmbedded<MisaResultItem[]>(body?.publishInvoiceResult)?.[0]
        const failed = [created, published].find((item) => item && item.Success === false)
        if (failed) {
            return {
                ok: false,
                errorCode: failed.ErrorCode ?? 'MISA_INVOICE_REJECTED',
                errorMessage: failed.DescriptionErrorCode ?? rejectMessage,
                httpStatus,
                raw,
            }
        }

        // Lệnh phát hành mà không có publishInvoiceResult nghĩa là MISA mới chỉ LẬP hóa đơn
        // (đã cấp số nhưng chưa ký, chưa gửi CQT). Trước đây chỗ này rơi về createInvoiceResult
        // rồi báo thành công — hệ thống ghi ISSUED và mở công nợ cho hóa đơn chưa hề ra.
        if (kind === 'publish' && !published) {
            return {
                ok: false,
                errorCode: 'MISA_NOT_PUBLISHED',
                errorMessage:
                    'MISA mới lập hóa đơn chứ chưa phát hành (không có publishInvoiceResult). Kiểm tra mẫu số và ký hiệu đã đăng ký tờ khai chưa.',
                httpStatus,
                raw,
            }
        }

        const result = published ?? created
        return {
            ok: true,
            invoiceNo: result?.InvNo,
            misaTransactionId: result?.TransactionID,
            templateNo: result?.InvTemplateNo ?? cfg.templateNo,
            serial: result?.InvSeries ?? cfg.serial,
            transactionId,
            httpStatus,
            raw,
        }
    }

    /** One row per VAT rate, summing the lines that carry it. */
    private taxRateSummary(lines: MisaInvoiceLine[]) {
        const byRate = new Map<string, { net: number; tax: number }>()
        for (const line of lines) {
            const key = line.taxRateName ?? vatRateName(line.taxRate)
            const current = byRate.get(key) ?? { net: 0, tax: 0 }
            current.net += Number(line.netAmount)
            current.tax += Number(line.taxAmount)
            byRate.set(key, current)
        }
        return [...byRate.entries()].map(([rateName, sums]) => ({
            VATRateName: rateName,
            AmountWithoutVAT: sums.net,
            AmountWithoutVATOC: sums.net,
            VATAmount: sums.tax,
            VATAmountOC: sums.tax,
        }))
    }

    /**
     * Asks MISA whether a transaction key already produced an invoice. A retry MUST call this
     * before publishing again, otherwise a worker that died after a successful publish would
     * issue the same invoice twice (spec v1.2 §10.2).
     */
    async getStatus(transactionId: string): Promise<MisaStatusResult> {
        const cfg = await this.config()
        if (cfg.mock) {
            return this.mockPublished.get(transactionId) ?? { published: false }
        }
        // POST {BaseURL}/invoice/status takes a BARE ARRAY of RefIDs — looked up by our own
        // key, which is why that key must exist before the first publish attempt.
        const { ok, raw } = await this.call(cfg, '/invoice/status', [transactionId])
        const body = raw as { success?: boolean; data?: unknown } | null
        const records = parseEmbedded<
            Array<{ InvNo?: string; InvTemplateNo?: string; InvSeries?: string }>
        >(body?.data)
        const record = records?.[0]
        if (!ok || !record) return { published: false, raw }
        return {
            published: !!record.InvNo,
            invoiceNo: record.InvNo,
            templateNo: record.InvTemplateNo,
            serial: record.InvSeries,
            raw,
        }
    }


    /**
     * Đường dẫn xem bản PDF của hóa đơn đã phát hành.
     *
     * `POST /invoice/publishview` nhận một MẢNG RefID trần và trả thẳng một URL trong
     * `data` (không phải chuỗi JSON lồng như các endpoint khác). MISA trả URL kể cả với
     * RefID chưa phát hành, nên bên gọi phải tự kiểm tra trạng thái trước.
     */
    async viewUrl(transactionId: string): Promise<string | null> {
        const cfg = await this.config()
        if (cfg.mock) {
            this.logger.debug(`MISA mock view ${transactionId}`)
            return null
        }

        const { ok, raw } = await this.call(cfg, '/invoice/publishview', [transactionId])
        const body = raw as { success?: boolean; data?: unknown } | null
        if (!ok || body?.success === false) return null
        const url = typeof body?.data === 'string' && body.data.startsWith('http') ? body.data : null
        if (!url) return null

        // MISA trả URL xem có thời hạn ngắn. Không tải thử PDF ở backend: máy chủ MISA
        // có thể trả body rỗng/khác phản hồi theo Node fetch nhưng lại mở PDF bình thường
        // trong trình duyệt người dùng. API chính thức đã xác nhận `data` là link xem PDF,
        // nên chuyển thẳng URL này cho browser.
        return url
    }

    /**
     * Trang tra cứu ổn định của meInvoice theo TransactionID. Khác với URL PDF
     * `/publishview` chỉ có hiệu lực ngắn, link này là đúng dạng MISA đặt trong
     * QR code hóa đơn (`/tra-cuu/?sc=<TransactionID>`).
     */
    async lookupUrl(transactionId: string): Promise<string | null> {
        const cfg = await this.config()
        if (cfg.mock) return null

        const api = new URL(cfg.baseUrl)
        const portalHost = api.hostname
            .replace(/^testapi\./i, 'test.')
            .replace(/^api\./i, '')
        return `${api.protocol}//${portalHost}/tra-cuu/?sc=${encodeURIComponent(transactionId)}`
    }

    /**
     * Cancelling at MISA is NOT wired: the public documentation names no cancel endpoint and
     * guessing one risks voiding the invoice on our side while the tax system still holds it.
     *
     * Until `MISA_CANCEL_PATH` is set to the path from MISA's full integration guide, this
     * reports that the cancellation has to be done in meInvoice by hand — it never claims a
     * cancellation happened.
     */
    async cancel(transactionId: string, reason: string) {
        const cfg = await this.config()
        if (cfg.mock) {
            this.mockPublished.delete(transactionId)
            return { ok: true, manualActionRequired: false, raw: { mock: true } }
        }

        const path = process.env.MISA_CANCEL_PATH
        if (!path) {
            this.logger.warn(
                `Hủy hóa đơn ${transactionId} chỉ được ghi nhận nội bộ — cần hủy thủ công trên meInvoice.`,
            )
            return {
                ok: true,
                manualActionRequired: true,
                raw: { skipped: 'MISA_CANCEL_PATH chưa cấu hình', reason },
            }
        }

        const { ok, httpStatus, raw } = await this.call(cfg, path, {
            RefIDs: [transactionId],
            Reason: reason,
        })
        return { ok, manualActionRequired: false, httpStatus, raw }
    }

    /** Stable transaction key generator for documents that need one before any DB write. */
    newTransactionKey() {
        return randomUUID()
    }
}
