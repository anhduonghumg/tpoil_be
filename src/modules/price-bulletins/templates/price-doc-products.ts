/**
 * Tên và thứ tự mặt hàng in trên thông báo giá / quyết định điều chỉnh giá.
 *
 * Danh mục sản phẩm đặt tên theo kiểu nội bộ ("Dầu Điêzen 0.001S Mức 5"), còn văn bản
 * niêm yết giá phải viết đúng tên thương mại như mẫu công ty vẫn dùng ("Dầu DO 0,001S-V").
 * Thứ tự cũng cố định theo mẫu — xăng trước, dầu sau — chứ không theo mã sản phẩm.
 *
 * Danh sách này cũng quyết định mặt hàng NÀO được lên bảng giá: danh mục sản phẩm còn
 * giữ cả loại đã ngừng bán (A95III), nhưng bảng giá niêm yết thì không được có nó. Thêm
 * hoặc bỏ mặt hàng khỏi bảng giá = sửa đúng danh sách này.
 */
export const PRICE_DOC_PRODUCTS: ReadonlyArray<{ code: string; label: string }> = [
    { code: 'E10III', label: 'Xăng E10 RON 95-III' },
    { code: 'E5II', label: 'Xăng E5 RON 92-II' },
    { code: 'DO05SII', label: 'Dầu DO 0,05S-II' },
    { code: 'DO01SV', label: 'Dầu DO 0,001S-V' },
]

const BY_CODE = new Map(PRICE_DOC_PRODUCTS.map((item, index) => [item.code, { ...item, index }]))

/** Tên in trên văn bản; mặt hàng chưa khai báo thì giữ nguyên tên trong danh mục. */
export function priceDocProductName(code: string | null | undefined, fallback: string) {
    return (code && BY_CODE.get(code)?.label) || fallback
}

/** Vị trí trong bảng in. Mặt hàng chưa khai báo xếp sau tất cả những cái đã khai. */
export function priceDocProductOrder(code: string | null | undefined) {
    const found = code ? BY_CODE.get(code) : undefined
    return found ? found.index : Number.MAX_SAFE_INTEGER
}

/** Mặt hàng này có được lên bảng giá bán lẻ không. */
export function isPriceDocProduct(code: string | null | undefined) {
    return Boolean(code && BY_CODE.has(code))
}

/**
 * Cột "Đơn vị tính" của quyết định là đơn vị GIÁ, không phải đơn vị đo của sản phẩm —
 * danh mục lưu "LITER" nhưng văn bản phải ghi "Đồng/lít".
 */
export function priceDocUnit(uom: string | null | undefined) {
    if (uom === 'KG') return 'Đồng/kg'
    if (uom === 'UNIT') return 'Đồng/đơn vị'
    return 'Đồng/lít'
}
