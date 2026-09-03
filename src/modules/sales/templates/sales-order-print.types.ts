/**
 * Ba mẫu đơn đặt hàng của kinh doanh, khác nhau ở phần thân:
 *  RETAIL          — "ĐƠN ĐẶT HÀNG": có phương tiện / lái xe / kho nhận trên từng dòng.
 *  LOT             — "ĐƠN ĐẶT HÀNG LÔ": xuất hóa đơn ngay sau khi xác nhận đơn hàng.
 *  LOT_BY_PROGRESS — "ĐƠN ĐẶT HÀNG LÔ": xuất hóa đơn theo tiến độ rút hàng.
 */
export type SalesOrderPrintVariant = 'RETAIL' | 'LOT' | 'LOT_BY_PROGRESS'

export type SalesOrderPrintLine = {
    index: number
    productName: string
    qty: number
    unitPrice: number
    /** Chiết khấu trên mỗi đơn vị — bản in ghi đúng con số này. */
    discountPerUnit: number
    lineTotal: number
    vehiclePlate: string
    driverName: string
    warehouseName: string
}

export type SalesOrderPrintPaymentPlan = {
    dueDate: Date | string
    percent: number | null
    amount: number
}

export type SalesOrderPrintData = {
    variant: SalesOrderPrintVariant
    orderNo: string
    orderDate: Date | string

    /** Bên mua: khách hàng — đơn đặt hàng viết từ phía họ. */
    buyerName: string
    buyerTaxCode: string
    buyerAddress: string

    /** Bên bán: pháp nhân của mình. */
    sellerName: string

    uomText: string
    paymentMethodText: string
    paymentTermType: 'SAME_DAY' | 'NET_DAYS'
    receiveDateText: string
    totalAmount: number

    lines: SalesOrderPrintLine[]
    paymentPlans: SalesOrderPrintPaymentPlan[]
}
