export type PurchaseOrderPrintLine = {
    index: number
    productName: string
    qty: number
    unitPrice: number
    discountAmount: number
    payableUnitPrice: number
    lineTotal: number
}

export type PurchaseOrderPrintData = {
    id: string
    orderNo: string
    orderDate: Date | string

    supplierName: string
    contractNo?: string
    deliveryLocation?: string

    companyAddress?: string
    companyPhone?: string
    paymentModeText?: string
    paymentDeadlineText?: string
    deliveryTimeText?: string

    totalQty: number
    totalAmount: number

    lines: PurchaseOrderPrintLine[]
}

export type PurchaseOrderPrintBatchInput = {
    ids: string[]
}
