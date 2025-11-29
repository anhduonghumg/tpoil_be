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
