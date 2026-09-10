/** Một vùng giá xuất hiện trên bảng, theo đúng thứ tự in ra. */
export type PriceDocRegion = {
    id: string
    code: string
    /** Nhãn in trên đầu cột, ví dụ "Vùng I". */
    name: string
}

/** Giá của một mặt hàng tại một vùng. */
export type PriceDocCell = {
    regionId: string
    newPrice: number
    /** Giá của bảng công bố liền trước. Null = mặt hàng/vùng này lần đầu có giá. */
    oldPrice: number | null
    /** newPrice − oldPrice. Null khi chưa có giá cũ để so. */
    delta: number | null
}

export type PriceDocRow = {
    productId: string
    /** Tên in trên bảng, ví dụ "Xăng E10 RON95 - Mức 3". */
    productName: string
    /** Đơn vị tính, ví dụ "Đồng/lít". */
    uom: string
    cells: PriceDocCell[]
    /**
     * Chênh lệch giá mới giữa vùng thứ hai và vùng đầu. Chỉ có nghĩa khi bảng đúng hai
     * vùng — mẫu giấy của công ty in cột "Chênh lệch V2/V1" cho trường hợp đó.
     */
    regionGap: number | null
}

export type PriceDocData = {
    /** Thời điểm bảng giá có hiệu lực, đã gồm cả giờ ("15h00 ngày 03/09/2026"). */
    effectiveFrom: Date
    /** Số quyết định do người lập nhập, ví dụ "03.09.2026/TP". */
    decisionNo: string | null
    /** Công văn Bộ Công Thương làm căn cứ, ví dụ "7010/BCT-TTTN". */
    basisDocNo: string | null
    basisDocDate: Date | null
    regions: PriceDocRegion[]
    rows: PriceDocRow[]
}
