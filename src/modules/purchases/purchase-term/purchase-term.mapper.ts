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

    private static stages(order: any): any[] {
        return (order.pricingRuns ?? []).flatMap((run: any) => run.stages ?? [])
    }

    private static hasStage(order: any, stageType: string): boolean {
        return this.stages(order).some((stage: any) => stage.stageType === stageType)
    }

    private static latestStage(order: any, stageType: string): any | null {
        return this.stages(order).find((stage: any) => stage.stageType === stageType) ?? null
    }

    private static nextActionLabel(nextAction: string): string {
        const map: Record<string, string> = {
            APPROVE_ORDER: 'Duyệt đơn',
            CREATE_RECEIPT: 'Nhận hàng',
            CALCULATE_TEMP_PRICE: 'Lập bảng giá tạm tính',
            CALCULATE_INVOICE_PRICE: 'Lập bảng giá theo bill',
            CALCULATE_OFFICIAL_FX: 'Lập bảng giá chính thức',
            COMPLETE_ORDER: 'Hoàn tất hồ sơ',
            VIEW_ONLY: 'Chỉ xem',
        }

        return map[nextAction] ?? nextAction
    }

    private static toWorkflow(order: any, nextAction: string) {
        const hasConfirmedReceipt = (order.receipts ?? []).some((receipt: any) => receipt.status === 'CONFIRMED')
        const hasEstimate = this.hasStage(order, 'ESTIMATE')
        const hasBill = this.hasStage(order, 'BILL_NORMALIZE')
        const hasFinal = this.hasStage(order, 'FINAL')
        const hasBossSheet = this.hasStage(order, 'BOSS_SHEET')
        const isCompleted = order.status === 'COMPLETED'

        const steps = [
            {
                key: 'ORDER',
                title: 'Hợp đồng & đơn đặt hàng',
                description: order.contractNo ? `Hợp đồng ${order.contractNo}` : 'Cần hợp đồng mua hợp lệ',
                status: order.status !== 'DRAFT' ? 'DONE' : nextAction === 'APPROVE_ORDER' ? 'CURRENT' : 'WAITING',
                action: 'APPROVE_ORDER',
            },
            {
                key: 'RECEIPT',
                title: 'Giao nhận',
                description: hasConfirmedReceipt ? 'Đã xác nhận nhận hàng' : 'Nhập số lượng thực nhận/V15',
                status: hasConfirmedReceipt ? 'DONE' : nextAction === 'CREATE_RECEIPT' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_RECEIPT',
            },
            {
                key: 'ESTIMATE_PRICE',
                title: 'Bảng giá tạm tính',
                description: hasEstimate ? 'Đã có bảng giá tạm tính' : 'Căn cứ MOPS, premium, tỷ giá và thuế',
                status: hasEstimate ? 'DONE' : nextAction === 'CALCULATE_TEMP_PRICE' ? 'CURRENT' : 'WAITING',
                action: 'CALCULATE_TEMP_PRICE',
            },
            {
                key: 'FINAL_PRICE',
                title: 'Bảng giá chính thức',
                description: hasFinal ? 'Đã chốt bảng giá chính thức' : hasBill ? 'Đã có bảng giá theo bill, chờ chốt tỷ giá' : 'Cần bảng giá theo bill trước khi chốt',
                status: hasFinal ? 'DONE' : nextAction === 'CALCULATE_INVOICE_PRICE' || nextAction === 'CALCULATE_OFFICIAL_FX' ? 'CURRENT' : 'WAITING',
                action: hasBill ? 'CALCULATE_OFFICIAL_FX' : 'CALCULATE_INVOICE_PRICE',
            },
            {
                key: 'SETTLEMENT',
                title: 'Quyết toán & thanh toán',
                description: isCompleted ? 'Hồ sơ đã hoàn tất' : hasBossSheet ? 'Đã có bảng tổng hợp, chờ hoàn tất' : 'Đối chiếu chênh lệch và chứng từ thanh toán',
                status: isCompleted ? 'DONE' : nextAction === 'COMPLETE_ORDER' ? 'CURRENT' : 'WAITING',
                action: 'COMPLETE_ORDER',
            },
        ]

        const missing = [
            !order.contractNo ? 'Hợp đồng mua hợp lệ' : null,
            !hasConfirmedReceipt ? 'Biên bản/phiếu nhận hàng đã xác nhận' : null,
            !hasEstimate ? 'Bảng giá tạm tính' : null,
            !hasBill ? 'Bảng giá theo bill' : null,
            !hasFinal ? 'Bảng giá chính thức' : null,
        ].filter(Boolean)

        return {
            currentAction: nextAction,
            currentActionLabel: this.nextActionLabel(nextAction),
            progress: Math.round((steps.filter((x) => x.status === 'DONE').length / steps.length) * 100),
            missing,
            steps,
        }
    }

    private static toPrintDocuments(order: any) {
        const hasEstimate = this.hasStage(order, 'ESTIMATE')
        const hasBill = this.hasStage(order, 'BILL_NORMALIZE')
        const hasFinal = this.hasStage(order, 'FINAL')
        const hasConfirmedReceipt = (order.receipts ?? []).some((receipt: any) => receipt.status === 'CONFIRMED')
        const finalStage = this.latestStage(order, 'FINAL')

        return [
            {
                key: 'APPENDIX',
                title: 'Phụ lục hợp đồng',
                description: 'In phụ lục gắn với hợp đồng mua và mã đơn TERM.',
                status: order.contractNo ? 'READY' : 'WAITING',
            },
            {
                key: 'PURCHASE_ORDER',
                title: 'Đơn đặt hàng',
                description: 'Đơn đặt hàng tạm tính gửi nhà cung cấp.',
                status: order.orderNo ? 'READY' : 'WAITING',
            },
            {
                key: 'ESTIMATE_PRICE',
                title: 'Bảng giá tạm tính',
                description: 'Bảng giá tạm tính chuyển tiền lần 1.',
                status: hasEstimate ? 'READY' : 'WAITING',
            },
            {
                key: 'BILL_PRICE',
                title: 'Bảng giá theo bill',
                description: 'Bảng giá sau khi có số liệu giao nhận/bill bồn.',
                status: hasBill ? 'READY' : 'WAITING',
            },
            {
                key: 'OFFICIAL_PRICE',
                title: 'Bảng giá chính thức',
                description: 'Bảng giá chốt sau khi có tỷ giá chính thức.',
                status: hasFinal ? 'READY' : 'WAITING',
            },
            {
                key: 'PAYMENT_REQUEST',
                title: 'Phiếu đề nghị thanh toán',
                description: finalStage ? 'Đề nghị thanh toán/chốt chênh lệch theo giá chính thức.' : 'Đề nghị thanh toán theo bảng giá tạm tính.',
                status: hasEstimate || hasFinal ? 'READY' : 'WAITING',
            },
            {
                key: 'DELIVERY_MINUTES',
                title: 'Biên bản giao nhận',
                description: 'Biên bản/phiếu giao nhận hàng tại kho bồn.',
                status: hasConfirmedReceipt ? 'READY' : 'WAITING',
            },
        ]
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
            transportMode: order.transportMode,

            orderDate: order.orderDate,
            expectedDate: order.expectedDate,

            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,

            supplierLocationId: order.supplierLocationId,
            supplierLocationName: order.supplierLocation?.name || null,

            contractId: order.contractId,
            contractNo: order.contractNo,

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
            contractId: order.contractId,
            contract: order.contract
                ? {
                      id: order.contract.id,
                      code: order.contract.code,
                      name: order.contract.name,
                      startDate: order.contract.startDate,
                      endDate: order.contract.endDate,
                      status: order.contract.status,
                  }
                : null,
            transportMode: order.transportMode,
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

            shipments: (order.termShipments ?? []).map((shipment: any) => ({
                id: shipment.id,
                transportMode: shipment.transportMode,
                vesselName: shipment.vesselName,
                voyageNo: shipment.voyageNo,
                blNo: shipment.blNo,
                loadingPort: shipment.loadingPort,
                dischargePort: shipment.dischargePort,
                etd: shipment.etd,
                eta: shipment.eta,
                surveyorName: shipment.surveyorName,
                note: shipment.note,
                status: shipment.status,
                createdAt: shipment.createdAt,
                updatedAt: shipment.updatedAt,
            })),

            logisticsCosts: (order.termLogisticsCosts ?? []).map((cost: any) => this.toLogisticsCost(cost)),

            nextAction,
            workflow: this.toWorkflow(order, nextAction),
            printDocuments: this.toPrintDocuments(order),

            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }

    static toLogisticsCost(cost: any) {
        return {
            id: cost.id,
            purchaseOrderId: cost.purchaseOrderId,
            shipmentId: cost.shipmentId,
            shipment: cost.shipment
                ? {
                      id: cost.shipment.id,
                      vesselName: cost.shipment.vesselName,
                      voyageNo: cost.shipment.voyageNo,
                      blNo: cost.shipment.blNo,
                      status: cost.shipment.status,
                  }
                : null,
            vendorCustomerId: cost.vendorCustomerId,
            vendorName: cost.vendor?.name || null,
            documentNo: cost.documentNo,
            documentDate: cost.documentDate,
            currency: cost.currency,
            fxRate: this.n(cost.fxRate),
            totalBeforeVat: this.n0(cost.totalBeforeVat),
            totalVat: this.n0(cost.totalVat),
            totalAfterVat: this.n0(cost.totalAfterVat),
            status: cost.status,
            note: cost.note,
            lines: (cost.lines ?? []).map((line: any) => ({
                id: line.id,
                costType: line.costType,
                productId: line.productId,
                purchaseOrderLineId: line.purchaseOrderLineId,
                goodsReceiptId: line.goodsReceiptId,
                allocationBasis: line.allocationBasis,
                amountBeforeVat: this.n0(line.amountBeforeVat),
                vatRate: this.n0(line.vatRate),
                vatAmount: this.n0(line.vatAmount),
                amountAfterVat: this.n0(line.amountAfterVat),
                amountVndBeforeVat: this.n(line.amountVndBeforeVat),
                isCapitalizedToCost: line.isCapitalizedToCost,
                note: line.note,
                sortOrder: line.sortOrder,
            })),
            createdAt: cost.createdAt,
            updatedAt: cost.updatedAt,
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
