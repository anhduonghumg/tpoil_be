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

    private static defaultWarehouse(order: any): any | null {
        const lines = order.lines ?? []
        if (!lines.length) return null
        const warehouseId = lines[0].receivingWarehouseId
        return lines.every((line: any) => line.receivingWarehouseId === warehouseId)
            ? lines[0].receivingWarehouse ?? null
            : null
    }

    private static totalAmount(lines: any[]): number {
        return (lines ?? []).reduce((sum: number, line: any) => {
            const qty = this.n0(line.orderedQty)
            const unitPrice = this.n0(line.unitPrice)
            const discount = this.n0(line.discountAmount)
            const taxRate = this.n0(line.taxRate)
            return sum + (qty * unitPrice - discount) * (1 + taxRate / 100)
        }, 0)
    }

    private static receivedQty(order: any, purchaseOrderLineId: string): number {
        return (order.receipts ?? []).reduce(
            (sum: number, receipt: any) =>
                sum +
                (receipt.lines ?? [])
                    .filter((line: any) => line.purchaseOrderLineId === purchaseOrderLineId)
                    .reduce((lineSum: number, line: any) => lineSum + this.n0(line.actualQty), 0),
            0,
        )
    }

    private static nextActionLabel(nextAction: string): string {
        const map: Record<string, string> = {
            APPROVE_ORDER: 'Sinh đơn đặt hàng',
            CREATE_ORDER_DOCUMENT: 'Lập đơn đặt hàng',
            CREATE_PAYMENT_REQUEST: 'Lập đề nghị thanh toán',
            CREATE_BANK_INSTRUCTION: 'Lập ủy nhiệm chi',
            MATCH_BANK_TRANSACTION: 'Đối chiếu giao dịch ngân hàng',
            CREATE_RECEIPT: 'Giao nhận',
            CALCULATE_TEMP_PRICE: 'Lập bảng giá tạm tính',
            CALCULATE_INVOICE_PRICE: 'Lập bảng xuất hóa đơn',
            CALCULATE_OFFICIAL_FX: 'Lập bảng chính thức',
            CREATE_SETTLEMENT_ADJUSTMENT: 'Điều chỉnh/hoàn tiền',
            CREATE_BOSS_SHEET: 'Lập bảng sếp',
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
        const isDirectOrder = order.termProfile?.flowType === 'DIRECT_ORDER'
        const hasOrderDocument = (order.termOrderDocuments ?? []).some((doc: any) => doc.status === 'ACTIVE')
        const hasPaymentRequest = (order.termPaymentRequests ?? []).some((request: any) => request.status !== 'CANCELLED')
        const hasActiveBatchItem = (order.termPaymentRequests ?? []).some((request: any) =>
            (request.batchItems ?? []).some((item: any) => item.status !== 'CANCELLED' && item.status !== 'FAILED'),
        )
        const hasSentToBankBatchItem = (order.termPaymentRequests ?? []).some((request: any) =>
            (request.batchItems ?? []).some((item: any) => item.status === 'SENT' || item.status === 'PARTIALLY_PAID' || item.status === 'PAID' || !!item.bankTransactionId),
        )
        const hasPaidBatchItem = (order.termPaymentRequests ?? []).some((request: any) =>
            (request.batchItems ?? []).some((item: any) => item.status === 'PAID' || item.status === 'PARTIALLY_PAID' || !!item.bankTransactionId),
        )
        const hasBankInstruction = (order.termBankInstructions ?? []).some((bank: any) => bank.status !== 'CANCELLED') || hasActiveBatchItem
        const hasMatchedBankTransaction = (order.termBankInstructions ?? []).some((bank: any) => bank.status === 'MATCHED' || !!bank.bankTransactionId) || hasPaidBatchItem
        const hasAdjustment = (order.termSettlementAdjustments ?? []).some((adjustment: any) => adjustment.status !== 'CANCELLED')
        const adjustmentNotNeeded = hasFinal && nextAction !== 'CREATE_SETTLEMENT_ADJUSTMENT'

        const steps = [
            {
                key: 'TERM_PROFILE',
                title: 'Hồ sơ TERM',
                description: order.contractNo ? `Hợp đồng ${order.contractNo}` : 'Cần hợp đồng TERM mua hợp lệ',
                status: order.contractNo ? 'DONE' : 'CURRENT',
                action: null,
            },
            {
                key: 'ESTIMATE_PRICE',
                title: 'Bảng tạm nếu có',
                description: isDirectOrder ? 'Luồng này bỏ qua bảng tạm và đi thẳng đơn đặt hàng' : hasEstimate ? 'Đã có bảng giá tạm tính' : 'Lập trước để làm căn cứ đơn đặt hàng',
                status: isDirectOrder || hasEstimate ? 'DONE' : nextAction === 'CALCULATE_TEMP_PRICE' ? 'CURRENT' : 'WAITING',
                action: 'CALCULATE_TEMP_PRICE',
            },
            {
                key: 'PURCHASE_ORDER',
                title: 'Đơn đặt hàng',
                description: hasOrderDocument ? 'Đã có đơn đặt hàng để in' : isDirectOrder ? 'Lập đơn đặt hàng trực tiếp' : 'Lập đơn đặt hàng từ bảng tạm',
                status: hasOrderDocument ? 'DONE' : nextAction === 'CREATE_ORDER_DOCUMENT' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_ORDER_DOCUMENT',
            },
            {
                key: 'PAYMENT_REQUEST',
                title: 'Đề nghị thanh toán',
                description: hasPaymentRequest ? 'Đã lập đề nghị thanh toán' : 'Lập phiếu đề nghị thanh toán theo đơn đặt hàng',
                status: hasPaymentRequest ? 'DONE' : nextAction === 'CREATE_PAYMENT_REQUEST' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_PAYMENT_REQUEST',
            },
            {
                key: 'BANK_TRANSACTION',
                title: 'UNC / ngân hàng',
                description: hasMatchedBankTransaction
                    ? 'Đã thanh toán/đối chiếu giao dịch ngân hàng'
                    : hasSentToBankBatchItem
                      ? 'Đã gửi ngân hàng, chưa thanh toán'
                      : hasBankInstruction
                        ? 'Đã vào bảng kê, chờ gửi ngân hàng'
                        : 'Ngân hàng lập bảng kê thanh toán',
                status: hasMatchedBankTransaction ? 'DONE' : hasSentToBankBatchItem || nextAction === 'CREATE_BANK_INSTRUCTION' || nextAction === 'MATCH_BANK_TRANSACTION' ? 'CURRENT' : 'WAITING',
                action: hasBankInstruction ? 'MATCH_BANK_TRANSACTION' : 'CREATE_BANK_INSTRUCTION',
            },
            {
                key: 'RECEIPT',
                title: 'Giao nhận',
                description: hasConfirmedReceipt ? 'Đã xác nhận giao nhận' : 'Nhập số lượng thực nhận/V15',
                status: hasConfirmedReceipt ? 'DONE' : nextAction === 'CREATE_RECEIPT' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_RECEIPT',
            },
            {
                key: 'INVOICE_PRICE',
                title: 'Bảng xuất hóa đơn',
                description: hasBill ? 'Đã có bảng xuất hóa đơn' : 'Lập bảng sau khi có bill/số liệu giao nhận',
                status: hasBill ? 'DONE' : nextAction === 'CALCULATE_INVOICE_PRICE' ? 'CURRENT' : 'WAITING',
                action: 'CALCULATE_INVOICE_PRICE',
            },
            {
                key: 'OFFICIAL_PRICE',
                title: 'Bảng chính thức',
                description: hasFinal ? 'Đã chốt bảng chính thức' : 'Lập khi có giá chính thức của nhà máy',
                status: hasFinal ? 'DONE' : nextAction === 'CALCULATE_OFFICIAL_FX' ? 'CURRENT' : 'WAITING',
                action: 'CALCULATE_OFFICIAL_FX',
            },
            {
                key: 'ADJUSTMENT',
                title: 'Điều chỉnh / hoàn tiền',
                description: hasAdjustment ? 'Đã ghi nhận điều chỉnh/hoàn tiền' : adjustmentNotNeeded ? 'Không phát sinh chênh lệch cần xử lý' : 'Xử lý chênh lệch sau bảng chính thức nếu có',
                status: hasAdjustment || adjustmentNotNeeded ? 'DONE' : nextAction === 'CREATE_SETTLEMENT_ADJUSTMENT' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_SETTLEMENT_ADJUSTMENT',
            },
            {
                key: 'BOSS_SHEET',
                title: 'Bảng sếp',
                description: hasBossSheet ? 'Đã có bảng sếp' : 'Lập bảng tổng hợp cuối hồ sơ',
                status: hasBossSheet ? 'DONE' : nextAction === 'CREATE_BOSS_SHEET' ? 'CURRENT' : 'WAITING',
                action: 'CREATE_BOSS_SHEET',
            },
            {
                key: 'SETTLEMENT',
                title: 'Hoàn tất',
                description: isCompleted ? 'Hồ sơ đã hoàn tất' : hasBossSheet ? 'Đã đủ bảng sếp, chờ hoàn tất hồ sơ' : 'Hoàn tất sau khi đủ chứng từ',
                status: isCompleted ? 'DONE' : nextAction === 'COMPLETE_ORDER' ? 'CURRENT' : 'WAITING',
                action: 'COMPLETE_ORDER',
            },
        ]

        const missing = [
            !order.contractNo ? 'Hợp đồng TERM mua hợp lệ' : null,
            !isDirectOrder && !hasEstimate ? 'Bảng giá tạm tính' : null,
            !hasOrderDocument ? 'Đơn đặt hàng' : null,
            !hasPaymentRequest ? 'Đề nghị thanh toán' : null,
            !hasMatchedBankTransaction ? 'Ủy nhiệm chi/giao dịch ngân hàng đã đối chiếu' : null,
            !hasConfirmedReceipt ? 'Biên bản/phiếu giao nhận đã xác nhận' : null,
            !hasBill ? 'Bảng xuất hóa đơn' : null,
            !hasFinal ? 'Bảng chính thức' : null,
            !hasBossSheet ? 'Bảng sếp' : null,
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
        const hasOrderDocument = (order.termOrderDocuments ?? []).some((doc: any) => doc.status === 'ACTIVE')
        const hasPaymentRequest = (order.termPaymentRequests ?? []).some((request: any) => request.status !== 'CANCELLED')

        return [
            {
                key: 'APPENDIX',
                title: 'Phụ lục hợp đồng',
                description: 'In phụ lục gắn với hợp đồng TERM mua.',
                status: order.contractNo ? 'READY' : 'WAITING',
            },
            {
                key: 'ESTIMATE_PRICE',
                title: 'Bảng giá tạm tính',
                description: 'Bảng giá tạm tính lập trước đơn đặt hàng.',
                status: hasEstimate ? 'READY' : 'WAITING',
            },
            {
                key: 'PURCHASE_ORDER',
                title: 'Đơn đặt hàng',
                description: 'Đơn đặt hàng sinh từ bảng tạm hoặc lập trực tiếp.',
                status: hasOrderDocument ? 'READY' : 'WAITING',
            },
            {
                key: 'PAYMENT_REQUEST',
                title: 'Phiếu đề nghị thanh toán',
                description: 'Phiếu đề nghị thanh toán theo đơn đặt hàng.',
                status: hasPaymentRequest ? 'READY' : 'WAITING',
            },
            {
                key: 'BILL_PRICE',
                title: 'Bảng xuất hóa đơn',
                description: 'Bảng giá sau khi có số liệu giao nhận/bill bồn.',
                status: hasBill ? 'READY' : 'WAITING',
            },
            {
                key: 'OFFICIAL_PRICE',
                title: 'Bảng chính thức',
                description: 'Bảng giá chốt sau khi có giá chính thức của nhà máy.',
                status: hasFinal ? 'READY' : 'WAITING',
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
        const paymentRequests = order.termPaymentRequests ?? []
        const paymentStatusRank: Record<string, number> = {
            PAID: 6,
            PARTIALLY_PAID: 5,
            SENT_TO_BANK: 4,
            IN_BATCH: 3,
            SUBMITTED: 2,
            DRAFT: 1,
        }
        const paymentStatus =
            [...paymentRequests]
                .filter((request: any) => request.status !== 'CANCELLED')
                .sort((a: any, b: any) => (paymentStatusRank[b.status] ?? 0) - (paymentStatusRank[a.status] ?? 0))[0]?.status ?? null

        const totalQty = lines.reduce((sum: number, x: any) => sum + this.n0(x.orderedQty), 0)
        const defaultWarehouse = this.defaultWarehouse(order)

        return {
            id: order.id,
            orderNo: order.orderNo,

            bizType: order.bizType,
            orderType: order.orderType,
            status: order.status,
            termFlowType: order.termProfile?.flowType,

            paymentMode: order.paymentMode,
            transportMode: order.termProfile?.transportMode,
            charterVessel: !!order.termProfile?.charterRequired,

            orderDate: order.orderDate,
            expectedDate: order.expectedDate,

            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,

            supplierLocationId: defaultWarehouse?.id ?? null,
            supplierLocationName: defaultWarehouse?.name || null,

            contractId: order.contractId,
            contractNo: order.contractNo,

            productSummary: this.productSummary(lines),
            lineCount: lines.length,

            totalQty,
            totalAmount: this.totalAmount(lines),

            termPremiumUsdPerBbl: this.n(order.termProfile?.premiumUsdPerBbl),
            premium: this.n(order.termProfile?.premiumUsdPerBbl),
            paymentStatus,

            nextAction,

            createdAt: order.createdAt,
            updatedAt: order.updatedAt,
        }
    }

    static toOrderDetail(order: any, nextAction: string) {
        const lines = order.lines ?? []
        const defaultWarehouse = this.defaultWarehouse(order)
        const totalQty = lines.reduce((sum: number, line: any) => sum + this.n0(line.orderedQty), 0)

        return {
            id: order.id,
            orderNo: order.orderNo,

            bizType: order.bizType,
            orderType: order.orderType,
            status: order.status,
            termFlowType: order.termProfile?.flowType,

            paymentMode: order.paymentMode,
            paymentTermType: order.paymentTermType,
            paymentTermDays: order.paymentTermDays,

            orderDate: order.orderDate,
            expectedDate: order.expectedDate,

            supplierCustomerId: order.supplierCustomerId,
            supplierName: order.supplier?.name || null,
            supplierCode: order.supplier?.code || null,

            supplierLocationId: defaultWarehouse?.id ?? null,
            supplierLocationName: defaultWarehouse?.name || null,

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
            transportMode: order.termProfile?.transportMode,
            charterVessel: !!order.termProfile?.charterRequired,
            deliveryLocation: order.deliveryLocation,

            paymentNote: order.paymentNote,
            note: order.note,

            productSummary: this.productSummary(lines),
            lineCount: lines.length,

            totalQty,
            totalAmount: this.totalAmount(lines),

            termPremiumUsdPerBbl: this.n(order.termProfile?.premiumUsdPerBbl),
            premium: this.n(order.termProfile?.premiumUsdPerBbl),

            lines: lines.map((line: any) => ({
                id: line.id,

                productId: line.productId,
                productCode: line.product?.code || null,
                productName: line.product?.name || null,

                supplierLocationId: line.receivingWarehouseId,
                supplierLocationName: line.receivingWarehouse?.name || null,

                orderedQty: this.n0(line.orderedQty),
                unitPrice: this.n(line.unitPrice),
                taxRate: this.n(line.taxRate),
                discountAmount: this.n0(line.discountAmount),
                withdrawnQty: this.receivedQty(order, line.id),
            })),

            receipts: (order.receipts ?? []).map((x: any) => {
                const receiptLine = x.lines?.[0] ?? null
                return {
                    id: x.id,
                    receiptNo: x.receiptNo,
                    status: x.status,
                    receiptDate: x.receiptDate,

                    purchaseOrderLineId: receiptLine?.purchaseOrderLineId ?? null,

                    supplierLocationId: x.warehouseId,
                    supplierLocationName: x.warehouse?.name || null,

                    productId: receiptLine?.productId ?? null,
                    productCode: receiptLine?.product?.code || null,
                    productName: receiptLine?.product?.name || null,

                    qty: this.n0(receiptLine?.actualQty),
                    standardQtyV15: this.n(receiptLine?.v15Qty),
                    billQty: this.n(receiptLine?.billQty),
                    tankQty: this.n(receiptLine?.tankQty),
                    temporaryWithdrawQty: this.n(receiptLine?.temporaryWithdrawQty),
                    billToTankLossQty: this.n(receiptLine?.billToTankLossQty),
                    receiptDocumentTemplate: x.receiptDocumentTemplate,
                    sourceFileName: x.sourceFileName,
                    sourceFileUrl: x.sourceFileUrl,
                    sourceFileMimeType: x.sourceFileMimeType,
                    sourceFileSizeBytes: this.n(x.sourceFileSizeBytes),

                    tempC: this.n(receiptLine?.temperatureC),
                    density: this.n(receiptLine?.density),

                    note: x.note,

                    createdAt: x.createdAt,
                    updatedAt: x.updatedAt,
                }
            }),

            pricingRuns: (order.pricingRuns ?? []).map((run: any) => this.toPricingRun(run)),

            shipments: (order.shipments ?? []).map((shipment: any) => ({
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
            termOrderDocuments: (order.termOrderDocuments ?? []).map((doc: any) => ({
                id: doc.id,
                documentNo: doc.documentNo,
                documentDate: doc.documentDate,
                status: doc.status,
                version: doc.version,
                sourceType: doc.sourceType,
                sourcePricingStageId: doc.sourcePricingStageId,
                totalQtyLiter: this.n(doc.totalQtyLiter),
                unitPriceVndPerLiter: this.n(doc.unitPriceVndPerLiter),
                amountVnd: this.n(doc.amountVnd),
                vatRate: this.n(doc.vatRate),
                totalAmountVnd: this.n(doc.totalAmountVnd),
                createdAt: doc.createdAt,
                updatedAt: doc.updatedAt,
            })),
            termPaymentRequests: (order.termPaymentRequests ?? []).map((request: any) => ({
                id: request.id,
                requestNo: request.requestNo,
                requestDate: request.requestDate,
                supplierName: request.supplierName,
                content: request.content,
                amountVnd: this.n(request.amountVnd),
                currency: request.currency,
                paymentDeadline: request.paymentDeadline,
                status: request.status,
                note: request.note,
                batchItems: (request.batchItems ?? []).map((item: any) => ({
                    id: item.id,
                    batchId: item.batchId,
                    batchNo: item.batch?.batchNo ?? null,
                    bankTransactionId: item.bankTransactionId,
                    amountVnd: this.n(item.amountVnd),
                    paidAmountVnd: this.n(item.paidAmountVnd),
                    status: item.status,
                    createdAt: item.createdAt,
                    updatedAt: item.updatedAt,
                })),
                createdAt: request.createdAt,
                updatedAt: request.updatedAt,
            })),
            termBankInstructions: (order.termBankInstructions ?? []).map((bank: any) => ({
                id: bank.id,
                paymentRequestId: bank.paymentRequestId,
                bankTransactionId: bank.bankTransactionId,
                instructionNo: bank.instructionNo,
                instructionDate: bank.instructionDate,
                amountVnd: this.n(bank.amountVnd),
                beneficiaryName: bank.beneficiaryName,
                beneficiaryBankAccount: bank.beneficiaryBankAccount,
                beneficiaryBankName: bank.beneficiaryBankName,
                status: bank.status,
                note: bank.note,
                createdAt: bank.createdAt,
                updatedAt: bank.updatedAt,
            })),
            termSettlementAdjustments: (order.termSettlementAdjustments ?? []).map((adjustment: any) => ({
                id: adjustment.id,
                finalPricingStageId: adjustment.finalPricingStageId,
                adjustmentType: adjustment.adjustmentType,
                amountVnd: this.n(adjustment.amountVnd),
                reason: adjustment.reason,
                status: adjustment.status,
                note: adjustment.note,
                createdAt: adjustment.createdAt,
                updatedAt: adjustment.updatedAt,
            })),

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
                transportLossAmountVnd: this.n(stage.transportLossAmountVnd),
                transportDeductionVnd: this.n(stage.transportDeductionVnd),

                envTaxAmountVnd: this.n(stage.envTaxAmountVnd),
                vatAmountVnd: this.n(stage.vatAmountVnd),

                amountVndBeforeTax: this.n(stage.amountVndBeforeTax),
                totalAmountVnd: this.n(stage.totalAmountVnd),
                unitVndPerLiter: this.n(stage.unitVndPerLiter),
                billTotalVnd: this.n(stage.billTotalVnd),
                tankUnitPriceVndPerLiter: this.n(stage.tankUnitPriceVndPerLiter),
                sellingUnitPriceVndPerLiter: this.n(stage.sellingUnitPriceVndPerLiter),
                temporaryAmountVnd: this.n(stage.temporaryAmountVnd),
                fundAdjustmentVndPerLiter: this.n(stage.fundAdjustmentVndPerLiter),
                fundAdjustmentAmountVnd: this.n(stage.fundAdjustmentAmountVnd),
                contractPaymentRate: this.n(stage.contractPaymentRate),
                contractPaymentAmountVnd: this.n(stage.contractPaymentAmountVnd),
                bankGuaranteeRate: this.n(stage.bankGuaranteeRate),
                bankGuaranteeFeeVnd: this.n(stage.bankGuaranteeFeeVnd),
                discountVndPerLiter: this.n(stage.discountVndPerLiter),

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
