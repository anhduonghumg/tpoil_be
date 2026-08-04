import { Injectable, Logger } from '@nestjs/common'
import { createHash } from 'crypto'

export type DeepSeekOrderDraft = {
    messageNo?: string | null
    date?: string | null
    customer?: string | null
    orderKind?: string | null
    plate?: string | null
    driver?: string | null
    lines?: Array<{ product?: string | null; quantity?: string | null; warehouse?: string | null }>
}

const SYSTEM_PROMPT = `Bạn là trợ lý tách thông tin đơn hàng xăng dầu.
Chỉ trả về JSON hợp lệ, không markdown, không giải thích.

Khóa JSON đúng như sau:
messageNo, date, customer, orderKind, plate, driver, lines
lines là mảng, mỗi phần tử có đúng: product, quantity, warehouse.
Thiếu thông tin thì trả "".

Quy tắc:
- Chỉ TÁCH TRƯỜNG từ văn bản. KHÔNG suy đoán, KHÔNG tự thêm tên khách/kho/sản phẩm không có trong văn bản.
- Giữ nguyên số lượng đúng như đã viết: 21.385 giữ là "21.385", không đổi thành 21385 hay 21.3850.
- Chỉ bỏ đơn vị (lít, lit, L).
- Nếu kho chỉ xuất hiện một lần cho cả đơn thì gán kho đó cho mọi dòng.
- orderKind chỉ nhận: "lấy mới", "lấy nhiều lần", "rút lô", hoặc "".`

/**
 * DeepSeek is the fallback when the regex parser comes up short — never the first step, and
 * never the decider.
 *
 * It is asked only to split text into fields; every value it returns is matched back against
 * our own master data afterwards, so it cannot invent a customer, depot or product. With no
 * API key configured the sales flow keeps working on regex alone.
 */
@Injectable()
export class DeepSeekClientService {
    private readonly logger = new Logger(DeepSeekClientService.name)
    /** Same paste twice in a row costs one call, not two. */
    private readonly cache = new Map<string, { value: DeepSeekOrderDraft; expiresAt: number }>()
    private lastCallAt = 0

    get isEnabled() {
        return !!process.env.DEEPSEEK_API_KEY
    }

    private cacheKey(text: string) {
        return createHash('md5').update(text).digest('hex')
    }

    /** Returns null when AI is unavailable — the caller falls back to regex-only output. */
    async normalize(rawText: string): Promise<DeepSeekOrderDraft | null> {
        if (!this.isEnabled) return null

        const input = String(rawText ?? '').trim().slice(0, 1500)
        if (!input) return null

        const key = this.cacheKey(input)
        const cached = this.cache.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.value

        // A double-click must not fire two paid calls back to back.
        const minGapMs = Number(process.env.DEEPSEEK_MIN_GAP_MS ?? 800)
        const wait = this.lastCallAt + minGapMs - Date.now()
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
        this.lastCallAt = Date.now()

        const baseUrl = (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, '')
        const controller = new AbortController()
        const timeout = setTimeout(
            () => controller.abort(),
            Number(process.env.DEEPSEEK_TIMEOUT_MS ?? 15000),
        )
        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
                },
                body: JSON.stringify({
                    model: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
                    messages: [
                        { role: 'system', content: SYSTEM_PROMPT },
                        { role: 'user', content: input },
                    ],
                    temperature: 0,
                    max_tokens: 2000,
                    response_format: { type: 'json_object' },
                    stream: false,
                }),
                signal: controller.signal,
            })
            if (!response.ok) {
                this.logger.warn(`DeepSeek trả HTTP ${response.status}, dùng kết quả regex.`)
                return null
            }
            const body = (await response.json()) as {
                choices?: Array<{ message?: { content?: string } }>
            }
            const content = body.choices?.[0]?.message?.content
            if (!content) return null

            const cleaned = content
                .replace(/^\s*```(?:json)?\s*/i, '')
                .replace(/```/g, '')
                .trim()
            const parsed = JSON.parse(cleaned) as DeepSeekOrderDraft
            this.cache.set(key, { value: parsed, expiresAt: Date.now() + 5 * 60_000 })
            return parsed
        } catch (error) {
            // AI is a convenience: a failure must never block order entry.
            this.logger.warn(
                `DeepSeek không dùng được (${error instanceof Error ? error.message : String(error)}), dùng kết quả regex.`,
            )
            return null
        } finally {
            clearTimeout(timeout)
        }
    }
}
