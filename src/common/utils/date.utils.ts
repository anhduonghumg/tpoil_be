// src/common/date.utils.ts
export function startOfDay(date: Date): Date {
    const d = new Date(date)
    d.setHours(0, 0, 0, 0)
    return d
}

export function addDays(date: Date, days: number): Date {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    return d
}

export function subDays(date: Date, days: number): Date {
    const d = new Date(date)
    d.setDate(d.getDate() - days)
    return d
}

export function diffInDays(a: Date, b: Date): number {
    const msPerDay = 24 * 60 * 60 * 1000
    const aStart = startOfDay(a).getTime()
    const bStart = startOfDay(b).getTime()
    return Math.round((aStart - bStart) / msPerDay)
}

export function formatDate(value?: Date): string | Date | null {
    if (!value) return ''
    const d = typeof value === 'string' ? new Date(value) : value
    if (isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
}

const vnDateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
})

/**
 * Ngày lịch Việt Nam của một thời điểm, dạng YYYY-MM-DD.
 *
 * Dùng thay cho `date.toISOString().slice(0, 10)` khi cần "ngày theo giờ Việt Nam":
 * toISOString luôn lấy ngày UTC, nên từ 0 đến 7 giờ sáng giờ VN nó trả về ngày hôm qua,
 * và với mốc "đầu ngày theo giờ địa phương" (setHours(0,0,0,0)) nó cũng lùi một ngày.
 * Định dạng qua Intl với múi giờ chỉ định nên đúng bất kể tiến trình đang chạy múi nào.
 *
 * KHÔNG dùng cho cột kiểu DATE lấy từ DB: Prisma trả DATE về đúng nửa đêm UTC, với
 * những giá trị đó toISOString().slice(0, 10) mới là đúng.
 */
export function vnDateKey(date: Date = new Date()): string {
    return vnDateFormatter.format(date)
}
