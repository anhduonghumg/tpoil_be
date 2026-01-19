// src/modules/price-bulletins/types/price-pdf-preview.ts
import type { ProductSuggestion } from '../matching/product-matcher'

export type PricePdfIssue =
    | { code: 'INVALID_PRICE'; message: string }
    | { code: 'PRODUCT_NOT_FOUND'; message: string; suggestions?: ProductSuggestion[] }
    | { code: 'PRODUCT_AMBIGUOUS'; message: string; suggestions: ProductSuggestion[] }
    | { code: 'REGION_NOT_FOUND'; message: string }

export type PricePdfPreviewLine = {
    rowNo: number
    productRaw: string
    canonicalKey: string

    productId?: string
    regionId?: string
    regionName?: string
    regionCode?: string

    matchedBy?: 'code' | 'alias' | 'name'
    confidence?: number

    price: number
    issues: PricePdfIssue[]
}

export type PricePdfPreviewResult = {
    source: 'TPOIL'
    effectiveFrom: string
    lines: PricePdfPreviewLine[]
    warnings: string[]
    conflict: null | { type: string; message: string }
    stats: {
        total: number
        ok: number
        withIssues: number
        notFound: number
        ambiguous: number
    }
}
