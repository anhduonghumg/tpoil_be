// src/modules/price-bulletins/matching/product-matcher.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type ProductSuggestion = { id: string; code?: string; name: string; score: number }

export type MatchResult =
    | { ok: true; productId: string; matchedBy: 'code' | 'alias' | 'name'; confidence: number; canonicalKey: string }
    | { ok: false; reason: 'NOT_FOUND' | 'AMBIGUOUS'; canonicalKey: string; suggestions: ProductSuggestion[] }

function stripDiacritics(input: string) {
    return input.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function normalizeText(input: string) {
    const s = stripDiacritics(String(input ?? ''))
        .toUpperCase()
        .replace(/[“”"]/g, '')
        .replace(/[_\-]+/g, ' ')
        .replace(/[^\w\s./%]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    return s
}

function simpleTokenScore(a: string, b: string) {
    const ta = new Set(a.split(' ').filter(Boolean))
    const tb = new Set(b.split(' ').filter(Boolean))
    if (!ta.size || !tb.size) return 0
    let inter = 0
    for (const t of ta) if (tb.has(t)) inter++
    const union = ta.size + tb.size - inter
    return union ? inter / union : 0
}

@Injectable()
export class ProductMatcher {
    private productsLoaded = false

    private codeMap = new Map<string, { id: string; code?: string; name: string }>()
    private nameMap = new Map<string, { id: string; code?: string; name: string }>()
    private all: Array<{ id: string; code?: string; name: string; codeKey: string; nameKey: string }> = []

    constructor(private readonly prisma: PrismaService) {}

    private parseAliasEnv(): Record<string, string> {
        const raw = process.env.PRICE_PDF_PRODUCT_ALIASES_TPOIL
        if (!raw) return {}
        try {
            return JSON.parse(raw)
        } catch {
            return {}
        }
    }

    async warmup() {
        if (this.productsLoaded) return
        const products = await this.prisma.product.findMany({
            select: { id: true, code: true, name: true },
        })

        this.all = products.map((p) => {
            const codeKey = normalizeText(p.code ?? '')
            const nameKey = normalizeText(p.name ?? '')
            return { id: p.id, code: p.code ?? undefined, name: p.name, codeKey, nameKey }
        })

        this.codeMap.clear()
        this.nameMap.clear()

        for (const p of this.all) {
            if (p.codeKey) this.codeMap.set(p.codeKey, { id: p.id, code: p.code, name: p.name })
            if (p.nameKey) this.nameMap.set(p.nameKey, { id: p.id, code: p.code, name: p.name })
        }

        this.productsLoaded = true
    }

    async match(rawName: string, opts?: { source?: 'TPOIL' | string }): Promise<MatchResult> {
        await this.warmup()

        const canonicalKey = normalizeText(rawName)
        if (!canonicalKey) {
            return { ok: false, reason: 'NOT_FOUND', canonicalKey, suggestions: [] }
        }

        const codeHit = this.codeMap.get(canonicalKey)
        if (codeHit) {
            return { ok: true, productId: codeHit.id, matchedBy: 'code', confidence: 1, canonicalKey }
        }

        const aliases = opts?.source === 'TPOIL' ? this.parseAliasEnv() : {}
        const aliasVal = aliases[rawName] ?? aliases[canonicalKey] ?? aliases[canonicalKey.replace(/\s+/g, ' ')]
        if (aliasVal) {
            const aliasKey = normalizeText(aliasVal)
            const byCode = this.codeMap.get(aliasKey)
            if (byCode) return { ok: true, productId: byCode.id, matchedBy: 'alias', confidence: 0.95, canonicalKey }
            const byName = this.nameMap.get(aliasKey)
            if (byName) return { ok: true, productId: byName.id, matchedBy: 'alias', confidence: 0.9, canonicalKey }
        }

        const nameHit = this.nameMap.get(canonicalKey)
        if (nameHit) {
            return { ok: true, productId: nameHit.id, matchedBy: 'name', confidence: 0.92, canonicalKey }
        }

        const scored = this.all
            .map((p) => {
                const score = Math.max(simpleTokenScore(canonicalKey, p.nameKey), simpleTokenScore(canonicalKey, p.codeKey))
                return { id: p.id, code: p.code, name: p.name, score }
            })
            .filter((x) => x.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 5)

        if (!scored.length) {
            return { ok: false, reason: 'NOT_FOUND', canonicalKey, suggestions: [] }
        }

        const top = scored[0]
        const second = scored[1]
        const ambiguous = second && top.score - second.score < 0.08 && top.score < 0.6

        if (ambiguous) {
            return { ok: false, reason: 'AMBIGUOUS', canonicalKey, suggestions: scored }
        }

        if (top.score >= 0.75) {
            return { ok: true, productId: top.id, matchedBy: 'name', confidence: Math.min(0.9, top.score), canonicalKey }
        }

        return { ok: false, reason: 'NOT_FOUND', canonicalKey, suggestions: scored }
    }
}
