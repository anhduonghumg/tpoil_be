export class PurchaseTermMapper {
    static toOrderListItem(order: any, nextAction: string) {
        const totalQty = (order.lines ?? []).reduce((sum: number, x: any) => sum + Number(x.orderedQty || 0), 0)
        const productSummary = (order.lines ?? [])
            .slice(0, 3)
            .map((x: any) => x.product?.name || 'N/A')
            .join(', ')

        return {
            id: order.id,
            orderNo: order.orderNo,
            bizType: order.bizType,
            orderType: order.orderType,
            status: order.status,
            paymentMode: order.paymentMode,
            orderDate: order.orderDate,
            expectedDate: order.expectedDate,
            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,
            productSummary,
            totalQty,
            totalAmount: order.totalAmount == null ? null : Number(order.totalAmount),
            nextAction,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }

    static toOrderDetail(order: any, nextAction: string) {
        return {
            id: order.id,
            orderNo: order.orderNo,
            bizType: order.bizType,
            orderType: order.orderType,
            status: order.status,
            paymentMode: order.paymentMode,
            paymentTermType: order.paymentTermType,
            paymentTermDays: order.paymentTermDays,
            orderDate: order.orderDate,
            expectedDate: order.expectedDate,
            note: order.note,
            contractNo: order.contractNo,
            deliveryLocation: order.deliveryLocation,
            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,
            supplierLocationId: order.supplierLocationId,
            supplierLocationName: order.supplierLocation?.name || null,
            totalQty: order.totalQty == null ? null : Number(order.totalQty),
            totalAmount: order.totalAmount == null ? null : Number(order.totalAmount),
            lines: (order.lines ?? []).map((line: any) => ({
                id: line.id,
                productId: line.productId,
                productName: line.product?.name || null,
                supplierLocationId: line.supplierLocationId,
                supplierLocationName: line.supplierLocation?.name || null,
                orderedQty: Number(line.orderedQty || 0),
                unitPrice: line.unitPrice == null ? null : Number(line.unitPrice),
                taxRate: line.taxRate == null ? null : Number(line.taxRate),
                discountAmount: Number(line.discountAmount || 0),
                withdrawnQty: Number(line.withdrawnQty || 0),
            })),
            receipts: (order.receipts ?? []).map((x: any) => ({
                id: x.id,
                receiptNo: x.receiptNo,
                status: x.status,
                receiptDate: x.receiptDate,
                qty: Number(x.qty || 0),
                standardQtyV15: x.standardQtyV15 == null ? null : Number(x.standardQtyV15),
                productId: x.productId,
                productName: x.product?.name || null,
            })),
            pricingRuns: (order.pricingRuns ?? []).map((run: any) => ({
                id: run.id,
                purchaseOrderLineId: run.purchaseOrderLineId,
                productId: run.productId,
                productName: run.product?.name || null,
                billDate: run.billDate,
                qtyBasisSelected: run.qtyBasisSelected,
                qtyActualTotal: run.qtyActualTotal == null ? null : Number(run.qtyActualTotal),
                qtyV15Total: run.qtyV15Total == null ? null : Number(run.qtyV15Total),
                status: run.status,
                stages: (run.stages ?? []).map((stage: any) => ({
                    id: stage.id,
                    stageType: stage.stageType,
                    totalAmountVnd: stage.totalAmountVnd == null ? null : Number(stage.totalAmountVnd),
                    unitVndPerLiter: stage.unitVndPerLiter == null ? null : Number(stage.unitVndPerLiter),
                })),
            })),
            nextAction,
            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }
}
