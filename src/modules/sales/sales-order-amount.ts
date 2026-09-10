import { Prisma } from '@prisma/client'

type SalesLineAmountInput = {
    unitPrice: Prisma.Decimal | number | string
    discountAmount: Prisma.Decimal | number | string | null | undefined
    transportFeeUnitPrice?: Prisma.Decimal | number | string | null
}

/**
 * Giá thu trên một đơn vị hàng.
 *
 * Cước được lưu độc lập để vận tải có thể báo cáo riêng, nhưng khi Sale đã thu cước
 * theo lít/kg/đơn vị hàng thì nó phải đi vào tổng tiền, hạn mức và hóa đơn.
 */
export function salesLineNetUnitPrice(line: SalesLineAmountInput) {
    return new Prisma.Decimal(line.unitPrice)
        .minus(new Prisma.Decimal(line.discountAmount ?? 0))
        .plus(new Prisma.Decimal(line.transportFeeUnitPrice ?? 0))
}

export function salesLineNetAmount(
    line: SalesLineAmountInput & { orderedActualQty: Prisma.Decimal | number | string },
) {
    return new Prisma.Decimal(line.orderedActualQty).mul(salesLineNetUnitPrice(line))
}
