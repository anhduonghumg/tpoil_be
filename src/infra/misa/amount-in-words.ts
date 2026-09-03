const ONES = [
    'không',
    'một',
    'hai',
    'ba',
    'bốn',
    'năm',
    'sáu',
    'bảy',
    'tám',
    'chín',
]

/** Nhóm ba chữ số. `full` = nhóm đứng sau, phải đọc đủ cả "không trăm". */
function readTriple(value: number, full: boolean) {
    const hundreds = Math.floor(value / 100)
    const tens = Math.floor((value % 100) / 10)
    const units = value % 10
    const parts: string[] = []

    if (full || hundreds > 0) parts.push(`${ONES[hundreds]} trăm`)

    if (tens === 0) {
        if (units > 0) {
            if (hundreds > 0 || full) parts.push('lẻ')
            parts.push(ONES[units])
        }
    } else if (tens === 1) {
        parts.push('mười')
        if (units === 1) parts.push('một')
        else if (units === 5) parts.push('lăm')
        else if (units > 0) parts.push(ONES[units])
    } else {
        parts.push(`${ONES[tens]} mươi`)
        if (units === 1) parts.push('mốt')
        else if (units === 4) parts.push('tư')
        else if (units === 5) parts.push('lăm')
        else if (units > 0) parts.push(ONES[units])
    }

    return parts.join(' ')
}

const SCALES = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']

/**
 * "564663000" → "Năm trăm sáu mươi tư triệu sáu trăm sáu mươi ba nghìn đồng".
 *
 * MISA nhận `TotalAmountInWords` và in nguyên văn lên hóa đơn, nên chuỗi này phải do
 * mình dựng chứ không để bên kia tự đoán. Cùng thuật toán với `amountInWords` của màn
 * hình xác nhận phát hành, để dòng chữ trên hộp và dòng chữ trên hóa đơn không lệch nhau.
 */
export function amountInWords(value: string | number) {
    const amount = Math.floor(Math.abs(Number(value ?? 0)))
    if (!Number.isFinite(amount)) return ''
    if (amount === 0) return 'Không đồng'

    const triples: number[] = []
    let rest = amount
    while (rest > 0) {
        triples.push(rest % 1000)
        rest = Math.floor(rest / 1000)
    }

    const chunks: string[] = []
    for (let index = triples.length - 1; index >= 0; index -= 1) {
        const triple = triples[index]
        if (triple === 0) continue
        const isLeading = index === triples.length - 1
        chunks.push(`${readTriple(triple, !isLeading)} ${SCALES[index] ?? ''}`.trim())
    }

    const text = chunks.join(' ').replace(/\s+/g, ' ').trim()
    return `${text.charAt(0).toUpperCase()}${text.slice(1)} đồng`
}
