export class PurchaseTermMapper {
    private static n(value: any): number | null {
        if (value === null || value === undefined) return null

        const num = Number(value)
        return Number.isFinite(num) ? num : null
    }

    private static n0(value: any): number {
        return this.n(value) ?? 0
    }

    private static productSummary(lines: any[]): string {
        const names = (lines ?? []).map((x: any) => x.product?.name || x.product?.code || 'N/A').filter(Boolean)

        if (!names.length) return ''

        const first = names.slice(0, 3).join(', ')
        const remain = names.length - 3

        return remain > 0 ? `${first} +${remain}` : first
    }

    static toOrderListItem(order: any, nextAction: string) {
        const lines = order.lines ?? []

        const totalQty = lines.reduce((sum: number, x: any) => sum + this.n0(x.orderedQty), 0)

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

            supplierLocationId: order.supplierLocationId,
            supplierLocationName: order.supplierLocation?.name || null,

            productSummary: this.productSummary(lines),
            lineCount: lines.length,

            totalQty,
            totalAmount: this.n(order.totalAmount),

            termPremiumUsdPerBbl: this.n(order.termPremiumUsdPerBbl),
            premium: this.n(order.termPremiumUsdPerBbl),

            nextAction,

            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }

    static toOrderDetail(order: any, nextAction: string) {
        const lines = order.lines ?? []

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

            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,
            supplierCode: order.supplier?.code || null,

            supplierLocationId: order.supplierLocationId,
            supplierLocationName: order.supplierLocation?.name || null,

            contractNo: order.contractNo,
            deliveryLocation: order.deliveryLocation,

            paymentNote: order.paymentNote,
            note: order.note,

            productSummary: this.productSummary(lines),
            lineCount: lines.length,

            totalQty: this.n(order.totalQty),
            totalAmount: this.n(order.totalAmount),

            termPremiumUsdPerBbl: this.n(order.termPremiumUsdPerBbl),
            premium: this.n(order.termPremiumUsdPerBbl),

            lines: lines.map((line: any) => ({
                id: line.id,

                productId: line.productId,
                productCode: line.product?.code || null,
                productName: line.product?.name || null,

                supplierLocationId: line.supplierLocationId,
                supplierLocationName: line.supplierLocation?.name || null,

                orderedQty: this.n0(line.orderedQty),
                unitPrice: this.n(line.unitPrice),
                taxRate: this.n(line.taxRate),
                discountAmount: this.n0(line.discountAmount),
                withdrawnQty: this.n0(line.withdrawnQty),
            })),

            receipts: (order.receipts ?? []).map((x: any) => ({
                id: x.id,
                receiptNo: x.receiptNo,
                status: x.status,
                receiptDate: x.receiptDate,

                purchaseOrderLineId: x.purchaseOrderLineId,

                supplierLocationId: x.supplierLocationId,
                supplierLocationName: x.supplierLocation?.name || null,

                productId: x.productId,
                productCode: x.product?.code || null,
                productName: x.product?.name || null,

                qty: this.n0(x.qty),
                standardQtyV15: this.n(x.standardQtyV15),

                tempC: this.n(x.tempC),
                density: this.n(x.density),

                note: x.note,

                createdAt: x.createdAt,
                updatedAt: x.updatedAt,
            })),

            // pricingRun: (order.pricingRuns ?? [])[0] ? this.toPricingRun((order.pricingRuns ?? [])[0]) : null,

            pricingRuns: (order.pricingRuns ?? []).map((run: any) => this.toPricingRun(run)),

            nextAction,

            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }

    private static toPricingRun(run: any) {
        return {
            id: run.id,

            purchaseOrderId: run.purchaseOrderId,
            purchaseOrderLineId: run.purchaseOrderLineId,

            productId: run.productId,
            productCode: run.product?.code || null,
            productName: run.product?.name || null,

            billDate: run.billDate,

            qtyBasisSelected: run.qtyBasisSelected,
            qtyBasisLocked: run.qtyBasisLocked,

            qtyActualTotal: this.n(run.qtyActualTotal),
            qtyV15Total: this.n(run.qtyV15Total),

            status: run.status,

            stages: (run.stages ?? []).map((stage: any) => ({
                id: stage.id,
                stageType: stage.stageType,

                mopsAvgUsdPerBbl: this.n(stage.mopsAvgUsdPerBbl),
                premiumUsdPerBbl: this.n(stage.premiumUsdPerBbl),

                unitUsdPerBbl: this.n(stage.unitUsdPerBbl),
                amountUsd: this.n(stage.amountUsd),

                fxRateDate: stage.fxRateDate,
                fxStage: stage.fxStage,
                fxRate: this.n(stage.fxRate),

                insuranceAmountVnd: this.n(stage.insuranceAmountVnd),
                shippingFeeVnd: this.n(stage.shippingFeeVnd),
                otherFeeVnd: this.n(stage.otherFeeVnd),

                envTaxAmountVnd: this.n(stage.envTaxAmountVnd),
                vatAmountVnd: this.n(stage.vatAmountVnd),

                amountVndBeforeTax: this.n(stage.amountVndBeforeTax),
                totalAmountVnd: this.n(stage.totalAmountVnd),
                unitVndPerLiter: this.n(stage.unitVndPerLiter),

                note: stage.note,

                costs: (stage.costs ?? []).map((cost: any) => ({
                    id: cost.id,
                    costType: cost.costType,
                    amountVnd: this.n(cost.amountVnd),
                    sourceDocNo: cost.sourceDocNo,
                    note: cost.note,
                })),

                lines: (stage.lines ?? []).map((line: any) => ({
                    id: line.id,

                    purchaseOrderLineId: line.purchaseOrderLineId,

                    productId: line.productId,
                    productCode: line.product?.code || null,
                    productName: line.product?.name || null,

                    supplierLocationId: line.supplierLocationId,
                    supplierLocationName: line.supplierLocation?.name || null,

                    qtyActual: this.n(line.qtyActual),
                    qtyV15: this.n(line.qtyV15),

                    mopsAvgUsdPerBbl: this.n(line.mopsAvgUsdPerBbl),
                    premiumUsdPerBbl: this.n(line.premiumUsdPerBbl),

                    unitUsdPerBbl: this.n(line.unitUsdPerBbl),
                    amountUsd: this.n(line.amountUsd),

                    unitVndPerLiter: this.n(line.unitVndPerLiter),
                    amountVnd: this.n(line.amountVnd),

                    note: line.note,

                    priceDays: (line.priceDays ?? []).map((day: any) => ({
                        id: day.id,
                        quoteDate: day.quoteDate,
                        priceUsdPerBbl: this.n(day.priceUsdPerBbl),
                    })),
                })),
                sheetRows: (stage.sheetRows ?? []).map((x: any) => ({
                    id: x.id,
                    rowNo: x.rowNo,
                    code: x.code,
                    label: x.label,
                    rowType: x.rowType,
                    valueType: x.valueType,
                    inputValue: x.inputValue == null ? null : Number(x.inputValue),
                    calculatedValue: x.calculatedValue == null ? null : Number(x.calculatedValue),
                    displayValue: x.displayValue,
                    unit: x.unit,
                    formula: x.formula,
                    note: x.note,
                    isInput: x.isInput,
                    isResult: x.isResult,
                    isBold: x.isBold,
                    isHighlighted: x.isHighlighted,
                    sortOrder: x.sortOrder,
                })),
            })),
        }
    }
}
