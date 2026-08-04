/**
 * Pure text parser for the quick-entry box — no database, no async, no side effects, so every
 * rule below is covered by a unit test.
 *
 * The rules come from the Apps Script that sales has been using in production, so they encode
 * real habits rather than guesses: labels written half a dozen ways, plates with or without
 * punctuation, Vietnamese thousand separators, and a warehouse named once for the whole order.
 */

export type ParsedOrderKind = 'SINGLE' | 'LOT' | 'WITHDRAWAL'

export type ParsedLine = {
    productText: string
    quantity: number | null
    quantityText: string
    warehouseText: string | null
}

export type ParsedOrder = {
    /** Sequence number inside the message — NOT a lot order reference. */
    messageNo: string | null
    dateText: string | null
    customerText: string | null
    orderKindText: string | null
    orderKind: ParsedOrderKind | null
    plateText: string | null
    driverText: string | null
    lines: ParsedLine[]
    /** Lines the parser could not place, kept so the UI can show what was ignored. */
    leftovers: string[]
}

const LABELS: Array<{ keys: string[]; field: keyof ParsedOrder }> = [
    { keys: ['DON', 'SO DON'], field: 'messageNo' },
    { keys: ['NGAY'], field: 'dateText' },
    { keys: ['KHACH HANG', 'KHACH', 'KH'], field: 'customerText' },
    { keys: ['LOAI DON', 'LOAI'], field: 'orderKindText' },
    { keys: ['BKS', 'BSX', 'BXS', 'XE', 'BIEN SO'], field: 'plateText' },
    { keys: ['LAI XE', 'LX', 'LXE', 'TAI XE'], field: 'driverText' },
]

function stripDiacritics(input: string) {
    return input
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
}

function labelKey(input: string) {
    return stripDiacritics(input).toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim()
}

/**
 * Vietnamese quantities: "15.050" and "15,050" both mean 15050.
 *
 * "15.05" is the awkward one — a trailing zero dropped somewhere upstream (the old AI step did
 * this regularly), so a 1-2 digit group after the separator is padded back to three rather
 * than read as a decimal.
 */
export function parseLocalizedNumber(raw: string): number | null {
    if (raw == null) return null
    const cleaned = String(raw).replace(/[^\d.,]/g, '').trim()
    if (!cleaned) return null

    if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) return Number(cleaned.replace(/\./g, ''))
    if (/^\d{1,3}(,\d{3})+$/.test(cleaned)) return Number(cleaned.replace(/,/g, ''))
    if (/^\d{1,3}\.\d{1,2}$/.test(cleaned)) {
        const [left, right] = cleaned.split('.')
        return Number(left + right.padEnd(3, '0'))
    }
    if (/^\d{1,3},\d{1,2}$/.test(cleaned)) {
        const [left, right] = cleaned.split(',')
        return Number(left + right.padEnd(3, '0'))
    }
    if (/^\d+$/.test(cleaned)) return Number(cleaned)

    const fallback = Number(cleaned.replace(/,/g, '.'))
    return Number.isFinite(fallback) ? fallback : null
}

/**
 * Plates arrive as "34C-118.23", "34c 118.23" or "88c05508", sometimes with the driver stuck
 * on the end ("34C-118.23 - Lx: Cường").
 */
export function normalizePlate(raw: string): string | null {
    if (!raw) return null
    let text = raw.replace(/\s*-\s*(?:LX|LXE|LAI XE|TAI XE)\s*:?.*$/i, '')
    text = stripDiacritics(text).toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (text.length < 6) return null
    const match = text.match(/^(\d{2}[A-Z]{1,2})(\d{3,6})$/)
    return match ? `${match[1]}-${match[2]}` : text
}

/** Anything shaped like a plate anywhere in the line, so an unlabelled "xe 88c05508" works. */
function findPlate(line: string): string | null {
    const match = stripDiacritics(line)
        .toUpperCase()
        .match(/\b(\d{2}\s?[A-Z]{1,2})[-\s.]?(\d{3}[.\s]?\d{2}|\d{3,6})\b/)
    return match ? normalizePlate(`${match[1]}${match[2]}`) : null
}

export function detectOrderKind(raw: string | null): ParsedOrderKind | null {
    if (!raw) return null
    const text = stripDiacritics(raw).toLowerCase()
    // Withdrawal first: "rút lô" also contains "lô", which would otherwise read as a lot order.
    if (/(rut lo|rut hang|lay lo|rut gui|rut luong|rut ton|giao hang gui|hang gui)/.test(text)) {
        return 'WITHDRAWAL'
    }
    if (/(lay nhieu lan|don lo|mua lo|hang lo)/.test(text)) return 'LOT'
    if (/(lay moi|mua moi|dat moi|lay 1 lan|lay mot lan|don le)/.test(text)) return 'SINGLE'
    return null
}

/** "Đơn 3" is only the position in the message, never a lot reference. */
function matchMessageNo(line: string): string | null {
    const match = labelKey(line).match(/^DON\s*:?\s*(\d+)$/)
    return match ? match[1] : null
}

/** Splits "Khách hàng: X" once, tolerating "=" and missing colons after a known label. */
function splitLabel(line: string): { key: string; value: string } | null {
    const normalized = line.replace(/\s*=\s*/, ': ')
    const colon = normalized.indexOf(':')
    if (colon > 0) {
        return { key: labelKey(normalized.slice(0, colon)), value: normalized.slice(colon + 1).trim() }
    }
    // "BKS 34C-118.23" — label and value with only a space between them.
    const key = labelKey(normalized)
    for (const label of LABELS) {
        for (const candidate of label.keys) {
            if (key.startsWith(`${candidate} `)) {
                return { key: candidate, value: normalized.slice(candidate.length).trim() }
            }
        }
    }
    return null
}

function fieldForKey(key: string): keyof ParsedOrder | null {
    for (const label of LABELS) {
        if (label.keys.includes(key)) return label.field
    }
    return null
}

/**
 * A detail line: product, quantity and optionally a warehouse, in whatever order and with
 * "-", ":" or "|" between them. Examples that must all work:
 *   "DO 05: 9.593 L - Kho HLHP"
 *   "E10 - 12.292 - Hải Linh HP"
 *   "12.292 E10"
 */
function parseDetail(line: string): ParsedLine | null {
    const parts = line
        .split(/\s*[-–—|]\s*|\s*:\s*/)
        .map((part) => part.trim())
        .filter(Boolean)

    if (parts.length >= 2) {
        let quantity: number | null = null
        let quantityText = ''
        const rest: string[] = []
        for (const part of parts) {
            const numeric = part.match(/^[\d.,]+\s*(?:L|LIT|LÍT|LITS)?$/i)
            if (numeric && quantity == null) {
                quantity = parseLocalizedNumber(part)
                quantityText = part
            } else {
                rest.push(part)
            }
        }
        if (quantity != null && rest.length) {
            return {
                productText: rest[0],
                quantity,
                quantityText,
                warehouseText: rest.length > 1 ? rest.slice(1).join(' ') : null,
            }
        }
        return null
    }

    // Single chunk: "12.292 E10" or "E10 12.292".
    const inline = line.match(/^([\d.,]+)\s*(?:L|LIT|LÍT)?\s+(.+)$/i)
    if (inline) {
        const quantity = parseLocalizedNumber(inline[1])
        if (quantity != null) {
            return { productText: inline[2].trim(), quantity, quantityText: inline[1], warehouseText: null }
        }
    }
    const trailing = line.match(/^(.+?)\s+([\d.,]+)\s*(?:L|LIT|LÍT)?$/i)
    if (trailing) {
        const quantity = parseLocalizedNumber(trailing[2])
        if (quantity != null) {
            return { productText: trailing[1].trim(), quantity, quantityText: trailing[2], warehouseText: null }
        }
    }
    return null
}

/** A bare "Kho HLHP" line naming the depot for the whole order. */
function warehouseOnly(line: string): string | null {
    const key = labelKey(line)
    if (/^KHO\b/.test(key) && !/\d{3,}/.test(key)) return line.replace(/^\s*[Kk]ho\s*:?\s*/, '').trim()
    return null
}

export function parseQuickEntry(input: string): ParsedOrder {
    const result: ParsedOrder = {
        messageNo: null,
        dateText: null,
        customerText: null,
        orderKindText: null,
        orderKind: null,
        plateText: null,
        driverText: null,
        lines: [],
        leftovers: [],
    }

    const cleaned = String(input ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[_–—]/g, '-')
        // Labels glued onto the previous line get their own line back.
        .replace(/\b(Đơn|Ngày|Khách hàng|Loại đơn|BKS|BSX|Lái xe|Lx)\s*:/gi, '\n$1:')

    const rawLines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean)
    let orderWarehouse: string | null = null

    for (const line of rawLines) {
        const messageNo = matchMessageNo(line)
        if (messageNo) {
            result.messageNo = messageNo
            continue
        }

        const labelled = splitLabel(line)
        if (labelled) {
            const field = fieldForKey(labelled.key)
            if (field) {
                // "BKS: 34C-118.23 - Lx: Cường" carries the driver too.
                if (field === 'plateText') {
                    const driverInside = labelled.value.match(/-\s*(?:Lx|Lxe|Lái xe|Lai xe)\s*:?\s*(.+)$/i)
                    if (driverInside && !result.driverText) result.driverText = driverInside[1].trim()
                    result.plateText = normalizePlate(labelled.value)
                } else if (field === 'orderKindText') {
                    result.orderKindText = labelled.value
                    result.orderKind = detectOrderKind(labelled.value)
                } else {
                    ;(result as Record<string, unknown>)[field] = labelled.value
                }
                continue
            }
        }

        const detail = parseDetail(line)
        if (detail) {
            result.lines.push(detail)
            continue
        }

        const warehouse = warehouseOnly(line)
        if (warehouse) {
            orderWarehouse = warehouse
            continue
        }

        // Unlabelled plate, e.g. "xe 88c05508".
        if (!result.plateText) {
            const plate = findPlate(line)
            if (plate) {
                result.plateText = plate
                continue
            }
        }

        // A bare keyword line such as "Rút lô APP" names the kind and often the customer.
        const kind = detectOrderKind(line)
        if (kind && !result.orderKind) {
            result.orderKind = kind
            result.orderKindText = line
            const remainder = line
                .replace(/(rút lô|rut lo|lấy lô|lay lo|lấy mới|lay moi|mua mới|mua moi|đơn lô|don lo|lấy nhiều lần|lay nhieu lan)/i, '')
                .trim()
            if (remainder && !result.customerText) result.customerText = remainder
            continue
        }

        result.leftovers.push(line)
    }

    // A depot named once applies to every line that did not name its own.
    if (orderWarehouse) {
        for (const line of result.lines) {
            if (!line.warehouseText) line.warehouseText = orderWarehouse
        }
    }

    // The driver is often just a name on its own line, left over after everything else.
    if (!result.driverText) {
        const index = result.leftovers.findIndex((line) => /^[\p{L}\s.]{4,40}$/u.test(line))
        if (index >= 0) result.driverText = result.leftovers.splice(index, 1)[0]
    }

    return result
}
