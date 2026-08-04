import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { randomUUID } from 'crypto'

export type MisaInvoiceLine = {
    lineNo: number
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

/** MISA identifies VAT by label ("10%", "KCT"), not by a number. */
export function vatRateName(rate: string | number | null | undefined) {
    if (rate == null || rate === '') return 'KCT'
    const fraction = Number(rate)
    if (!Number.isFinite(fraction)) return 'KCT'
    if (fraction === 0) return '0%'
    return `${Number((fraction * 100).toFixed(4))}%`
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
    /** Mock-mode ledger so a "did this already publish?" query behaves like the real thing. */
    private readonly mockPublished = new Map<string, MisaStatusResult>()
    private lastPublishAt = 0

    /**
     * Mock when credentials are missing, or when MISA_MOCK is set explicitly — tests and demos
     * must be able to run the sales flow without touching a real invoicing system.
     */
    get isMock() {
        if (process.env.MISA_MOCK === '1') return true
        return !process.env.MISA_BASE_URL || !process.env.MISA_APP_ID
    }

    private get baseUrl() {
        return (process.env.MISA_BASE_URL ?? '').replace(/\/+$/, '')
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
    private async authenticate(): Promise<string> {
        if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value

        const response = await fetch(`${this.baseUrl}/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                appid: process.env.MISA_APP_ID,
                taxcode: process.env.MISA_TAX_CODE,
                username: process.env.MISA_USERNAME,
                password: process.env.MISA_PASSWORD,
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

    private async call(path: string, payload: unknown) {
        const token = await this.authenticate()
        const response = await fetch(`${this.baseUrl}${path}`, {
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
    private async respectPublishSpacing() {
        const minGapMs = Number(process.env.MISA_PUBLISH_MIN_GAP_MS ?? 3000)
        const waitMs = this.lastPublishAt + minGapMs - Date.now()
        if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
        this.lastPublishAt = Date.now()
    }

    async publish(request: MisaPublishRequest): Promise<MisaPublishResult> {
        if (this.isMock) {
            const result: MisaStatusResult = {
                published: true,
                invoiceNo: `MOCK-${request.transactionId}`,
                templateNo: process.env.MISA_TEMPLATE_NO ?? '1/001',
                serial: process.env.MISA_SERIAL ?? 'C25MOCK',
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

        await this.respectPublishSpacing()

        // MISA wants each money field twice: OC = original currency, plain = base currency.
        // Only VND is in scope today (exchange rate 1), so the two are equal.
        const numeric = (value: string) => Number(value)
        const invoice = {
            RefID: request.transactionId,
            InvTemplateNo: process.env.MISA_TEMPLATE_NO,
            InvSeries: process.env.MISA_SERIAL,
            InvDate: `${request.invoiceDate}T00:00:00`,
            CurrencyCode: request.currency,
            ExchangeRate: 1,
            PaymentMethodName: process.env.MISA_PAYMENT_METHOD ?? 'TM/CK',
            BuyerLegalName: request.buyerName,
            BuyerTaxCode: request.buyerTaxCode ?? '',
            BuyerAddress: request.buyerAddress ?? '',
            BuyerEmail: request.buyerEmail ?? '',
            TotalSaleAmount: numeric(request.subtotal),
            TotalSaleAmountOC: numeric(request.subtotal),
            TotalDiscountAmount: numeric(request.discountTotal),
            TotalDiscountAmountOC: numeric(request.discountTotal),
            TotalAmountWithoutVAT: numeric(request.subtotal) - numeric(request.discountTotal),
            TotalAmountWithoutVATOC: numeric(request.subtotal) - numeric(request.discountTotal),
            TotalVATAmount: numeric(request.taxTotal),
            TotalVATAmountOC: numeric(request.taxTotal),
            TotalAmount: numeric(request.grandTotal),
            TotalAmountOC: numeric(request.grandTotal),
            // Per-rate summary block; MISA rejects the invoice without it.
            TaxRateInfo: this.taxRateSummary(request.lines),
            OriginalInvoiceDetail: request.lines.map((line) => {
                const net = numeric(line.netAmount)
                const tax = numeric(line.taxAmount)
                return {
                    LineNumber: line.lineNo,
                    ItemType: 1,
                    ItemName: line.description,
                    UnitName: line.uom,
                    Quantity: numeric(line.qty),
                    UnitPrice: numeric(line.unitPrice),
                    UnitPriceOC: numeric(line.unitPrice),
                    Amount: net,
                    AmountOC: net,
                    AmountWithoutVAT: net,
                    AmountWithoutVATOC: net,
                    DiscountAmount: numeric(line.discountAmount),
                    DiscountAmountOC: numeric(line.discountAmount),
                    VATRateName: vatRateName(line.taxRate),
                    VATAmount: tax,
                    VATAmountOC: tax,
                    TotalAmount: net + tax,
                    TotalAmountOC: net + tax,
                }
            }),
        }

        // POST {BaseURL}/invoice — InvoiceData is a real array, not a JSON string.
        const { httpStatus, ok, raw } = await this.call('/invoice', {
            SignType: Number(process.env.MISA_SIGN_TYPE ?? 1),
            InvoiceData: [invoice],
            PublishInvoiceData: [{ RefID: request.transactionId }],
        })
        const body = raw as
            | {
                  success?: boolean
                  errorCode?: string
                  descriptionErrorCode?: string
                  createInvoiceResult?: unknown
                  publishInvoiceResult?: unknown
              }
            | null

        if (!ok || body?.success === false) {
            return {
                ok: false,
                errorCode: body?.errorCode ?? `HTTP_${httpStatus}`,
                errorMessage: body?.descriptionErrorCode ?? 'MISA từ chối phát hành hóa đơn.',
                httpStatus,
                raw,
            }
        }

        // The envelope can succeed while the individual invoice fails — check both results.
        type MisaResultItem = {
            RefID?: string
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
                errorMessage: failed.DescriptionErrorCode ?? 'MISA từ chối hóa đơn.',
                httpStatus,
                raw,
            }
        }

        const result = published ?? created
        return {
            ok: true,
            invoiceNo: result?.InvNo,
            templateNo: result?.InvTemplateNo ?? process.env.MISA_TEMPLATE_NO,
            serial: result?.InvSeries ?? process.env.MISA_SERIAL,
            transactionId: request.transactionId,
            httpStatus,
            raw,
        }
    }

    /** One row per VAT rate, summing the lines that carry it. */
    private taxRateSummary(lines: MisaInvoiceLine[]) {
        const byRate = new Map<string, { net: number; tax: number }>()
        for (const line of lines) {
            const key = vatRateName(line.taxRate)
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
        if (this.isMock) {
            return this.mockPublished.get(transactionId) ?? { published: false }
        }
        // POST {BaseURL}/invoice/status takes a BARE ARRAY of RefIDs — looked up by our own
        // key, which is why that key must exist before the first publish attempt.
        const { ok, raw } = await this.call('/invoice/status', [transactionId])
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
     * Cancelling at MISA is NOT wired: the public documentation names no cancel endpoint and
     * guessing one risks voiding the invoice on our side while the tax system still holds it.
     *
     * Until `MISA_CANCEL_PATH` is set to the path from MISA's full integration guide, this
     * reports that the cancellation has to be done in meInvoice by hand — it never claims a
     * cancellation happened.
     */
    async cancel(transactionId: string, reason: string) {
        if (this.isMock) {
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

        const { ok, httpStatus, raw } = await this.call(path, {
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
