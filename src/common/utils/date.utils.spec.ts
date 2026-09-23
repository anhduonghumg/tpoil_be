import { vnDateKey } from './date.utils'

describe('vnDateKey', () => {
    it('từ 0 đến 7 giờ sáng giờ VN vẫn là ngày của VN, không lùi về ngày UTC', () => {
        // 02:00 ngày 20/9 giờ VN = 19:00 ngày 19/9 UTC.
        expect(vnDateKey(new Date('2026-09-19T19:00:00Z'))).toBe('2026-09-20')
    })

    it('cuối ngày VN vẫn là ngày đó', () => {
        // 23:30 ngày 19/9 giờ VN = 16:30 ngày 19/9 UTC.
        expect(vnDateKey(new Date('2026-09-19T16:30:00Z'))).toBe('2026-09-19')
    })
})
