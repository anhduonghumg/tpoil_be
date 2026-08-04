import {
    detectOrderKind,
    normalizePlate,
    parseLocalizedNumber,
    parseQuickEntry,
} from './quick-entry.parser'

describe('parseLocalizedNumber', () => {
    it('reads Vietnamese thousand separators', () => {
        expect(parseLocalizedNumber('15.050')).toBe(15050)
        expect(parseLocalizedNumber('9.593')).toBe(9593)
        expect(parseLocalizedNumber('15,050')).toBe(15050)
        expect(parseLocalizedNumber('100.000')).toBe(100000)
    })

    it('restores a trailing zero dropped upstream', () => {
        // The old AI step regularly turned 15.050 into 15.05.
        expect(parseLocalizedNumber('15.05')).toBe(15050)
        expect(parseLocalizedNumber('12.3')).toBe(12300)
    })

    it('ignores unit words', () => {
        expect(parseLocalizedNumber('9.593 L')).toBe(9593)
        expect(parseLocalizedNumber('12.292 lít')).toBe(12292)
    })

    it('returns null for junk', () => {
        expect(parseLocalizedNumber('')).toBeNull()
        expect(parseLocalizedNumber('abc')).toBeNull()
    })
})

describe('normalizePlate', () => {
    it('accepts the shapes people actually type', () => {
        expect(normalizePlate('34C-118.23')).toBe('34C-11823')
        expect(normalizePlate('34c 118.23')).toBe('34C-11823')
        expect(normalizePlate('88c05508')).toBe('88C-05508')
        expect(normalizePlate('88C-055.08')).toBe('88C-05508')
    })

    it('drops a driver name stuck onto the plate', () => {
        expect(normalizePlate('34C-118.23 - Lx: Nguyễn Đình Cường')).toBe('34C-11823')
    })
})

describe('detectOrderKind', () => {
    it('reads a withdrawal before mistaking it for a lot order', () => {
        expect(detectOrderKind('rút lô')).toBe('WITHDRAWAL')
        expect(detectOrderKind('Rut lo hang gui')).toBe('WITHDRAWAL')
        expect(detectOrderKind('lấy lô')).toBe('WITHDRAWAL')
    })

    it('reads one-off and lot orders', () => {
        expect(detectOrderKind('lấy mới')).toBe('SINGLE')
        expect(detectOrderKind('mua moi')).toBe('SINGLE')
        expect(detectOrderKind('lấy nhiều lần')).toBe('LOT')
    })

    it('returns null when nothing matches', () => {
        expect(detectOrderKind('abc')).toBeNull()
        expect(detectOrderKind(null)).toBeNull()
    })
})

describe('parseQuickEntry', () => {
    it('reads the standard one-off order from the spec', () => {
        const result = parseQuickEntry(`14/7
Khách hàng: Chí Linh HD
Loại đơn: lấy mới
Xe: 34C-118.23
Lái xe: Nguyễn Đình Cường
DO 05: 9.593 L - Kho HLHP
E10: 9.069 L - Kho HLHP`)

        expect(result.customerText).toBe('Chí Linh HD')
        expect(result.orderKind).toBe('SINGLE')
        expect(result.plateText).toBe('34C-11823')
        expect(result.driverText).toBe('Nguyễn Đình Cường')
        expect(result.lines).toHaveLength(2)
        expect(result.lines[0]).toMatchObject({ productText: 'DO 05', quantity: 9593, warehouseText: 'Kho HLHP' })
        expect(result.lines[1]).toMatchObject({ productText: 'E10', quantity: 9069 })
    })

    it('reads the lot order from the spec', () => {
        const result = parseQuickEntry(`Khách hàng: Dầu Mỏ APP
Loại đơn: lấy nhiều lần
E10: 100.000 L
Kho: Hải Linh HP`)

        expect(result.customerText).toBe('Dầu Mỏ APP')
        expect(result.orderKind).toBe('LOT')
        expect(result.lines[0]).toMatchObject({ productText: 'E10', quantity: 100000 })
        // A depot named once covers the whole order.
        expect(result.lines[0].warehouseText).toBe('Hải Linh HP')
    })

    it('reads the withdrawal from the spec and keeps the message number out of the lot reference', () => {
        const result = parseQuickEntry(`Đơn 3
Khách hàng: Dầu Mỏ APP
Loại đơn: rút lô
BKS: 88C-055.08
Lái xe: Đỗ Văn Hiếu
E10: 12.292 L - Kho Hải Linh HP`)

        expect(result.messageNo).toBe('3')
        expect(result.orderKind).toBe('WITHDRAWAL')
        expect(result.plateText).toBe('88C-05508')
        expect(result.driverText).toBe('Đỗ Văn Hiếu')
        expect(result.lines[0]).toMatchObject({ productText: 'E10', quantity: 12292 })
    })

    it('reads the terse free-form version of the same withdrawal', () => {
        // No labels, different order, no diacritics on the plate.
        const result = parseQuickEntry(`Rút lô APP
Kho HLHP
12.292 E10
Đỗ Văn Hiếu
xe 88c05508`)

        expect(result.orderKind).toBe('WITHDRAWAL')
        expect(result.customerText).toBe('APP')
        expect(result.plateText).toBe('88C-05508')
        expect(result.driverText).toBe('Đỗ Văn Hiếu')
        expect(result.lines[0]).toMatchObject({ productText: 'E10', quantity: 12292 })
        expect(result.lines[0].warehouseText).toBe('HLHP')
    })

    it('does not depend on line order', () => {
        const a = parseQuickEntry(`Khách hàng: APP\nBKS: 88C-055.08\nE10: 1.000 - Kho HLHP`)
        const b = parseQuickEntry(`E10: 1.000 - Kho HLHP\nBKS: 88C-055.08\nKhách hàng: APP`)
        expect(b.customerText).toBe(a.customerText)
        expect(b.plateText).toBe(a.plateText)
        expect(b.lines[0].quantity).toBe(a.lines[0].quantity)
    })

    it('tolerates missing colons, "=" and label spelling variants', () => {
        const result = parseQuickEntry(`KH = Chí Linh HD\nBSX 34C-118.23\nLx Nguyễn Đình Cường\nDO 05 - 9.593 - HLHP`)
        expect(result.customerText).toBe('Chí Linh HD')
        expect(result.plateText).toBe('34C-11823')
        expect(result.driverText).toBe('Nguyễn Đình Cường')
        expect(result.lines[0].quantity).toBe(9593)
    })

    it('pulls the driver out of a plate line that carries both', () => {
        const result = parseQuickEntry(`BKS: 34C-118.23 - Lx: Nguyễn Đình Cường\nE10: 1.000`)
        expect(result.plateText).toBe('34C-11823')
        expect(result.driverText).toBe('Nguyễn Đình Cường')
    })

    it('keeps what it could not place instead of discarding it', () => {
        const result = parseQuickEntry(`Khách hàng: APP\nE10: 1.000\nghi chú linh tinh 123 xyz !!!`)
        expect(result.leftovers.length).toBeGreaterThan(0)
    })
})
