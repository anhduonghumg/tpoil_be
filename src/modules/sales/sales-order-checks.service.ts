import { Injectable } from '@nestjs/common'
import {
    ContractKind,
    ContractStatus,
    CustomerStatus,
    MasterStatus,
    PaymentTermType,
    Prisma,
    RiskLevel,
    SalesApprovalType,
    SalesOrderStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PurchaseTermCostLayerService } from 'src/modules/purchases/purchase-term/purchase-term-cost-layer.service'
import { startOfToday } from './receivables.service'

export type SalesCheckViolation = {
    approvalType: SalesApprovalType
    code: string
    message: string
    detail?: Record<string, unknown>
}

export type SalesCheckWarning = {
    code: string
    message: string
    detail?: Record<string, unknown>
}

export type SalesOrderCheckResult = {
    violations: SalesCheckViolation[]
    warnings: SalesCheckWarning[]
    orderValue: string
    creditExposure: string
    creditLimit: string | null
}

type TxOrPrisma = Prisma.TransactionClient | PrismaService

/** Order statuses that count as "approved but not yet invoiced" credit exposure. */
const EXPOSURE_STATUSES: SalesOrderStatus[] = [
    SalesOrderStatus.CONFIRMED,
    SalesOrderStatus.AWAITING_STOCK,
    SalesOrderStatus.PARTIALLY_RESERVED,
    SalesOrderStatus.RESERVED,
    SalesOrderStatus.WAREHOUSE_PROCESSING,
    SalesOrderStatus.PARTIALLY_DELIVERED,
    SalesOrderStatus.DELIVERED,
    SalesOrderStatus.AWAITING_RECONCILIATION,
    SalesOrderStatus.AWAITING_INVOICE,
]

/**
 * Internal checks that run when a SINGLE/LOT sales order is submitted for review
 * (sales-implementation-spec v1.2 §7). Violations map 1-1 to approval request types.
 */
@Injectable()
export class SalesOrderChecksService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly costLayers: PurchaseTermCostLayerService,
    ) {}

    /**
     * Value after discount and VAT (D3: exposure is measured on the receivable amount).
     * taxRate is stored as a fraction (0.1 = 10%), enforced by a 0..1 DB check.
     */
    private lineValue(line: {
        orderedActualQty: Prisma.Decimal
        unitPrice: Prisma.Decimal
        discountAmount: Prisma.Decimal
        taxRate: Prisma.Decimal | null
    }) {
        const net = line.orderedActualQty.mul(line.unitPrice).minus(line.discountAmount)
        if (line.taxRate == null) return net
        return net.plus(net.mul(line.taxRate))
    }

    orderValue(lines: Parameters<SalesOrderChecksService['lineValue']>[0][]) {
        return lines.reduce((sum, line) => sum.plus(this.lineValue(line)), new Prisma.Decimal(0))
    }

    async run(db: TxOrPrisma, orderId: string): Promise<SalesOrderCheckResult> {
        const violations: SalesCheckViolation[] = []
        const warnings: SalesCheckWarning[] = []

        const order = await db.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: {
                customer: {
                    include: {
                        riskFlags: { where: { deletedAt: null, level: RiskLevel.High } },
                    },
                },
                contract: { include: { items: true } },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true } },
                        issueWarehouse: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                                status: true,
                                legalEntityId: true,
                                legalEntity: { select: { partyId: true } },
                            },
                        },
                    },
                },
            },
        })

        // ===== 1) Hồ sơ khách hàng & hợp đồng =====
        if (order.customer.status !== CustomerStatus.Active || order.customer.deletedAt) {
            violations.push({
                approvalType: SalesApprovalType.EXCEPTION,
                code: 'CUSTOMER_NOT_ACTIVE',
                message: `Khách hàng ${order.customer.name} không ở trạng thái hoạt động.`,
                detail: { customerStatus: order.customer.status },
            })
        }
        if (order.customer.riskFlags.length) {
            violations.push({
                approvalType: SalesApprovalType.EXCEPTION,
                code: 'CUSTOMER_RISK_BLOCKED',
                message: `Khách hàng đang có ${order.customer.riskFlags.length} cảnh báo rủi ro mức cao.`,
                detail: {
                    riskFlags: order.customer.riskFlags.map((flag) => ({
                        source: flag.source,
                        message: flag.message,
                    })),
                },
            })
        }

        const orderDate = order.orderDate
        if (order.contract) {
            const contractInvalid =
                order.contract.kind !== ContractKind.SALES ||
                order.contract.status !== ContractStatus.Active ||
                order.contract.deletedAt != null ||
                order.contract.startDate > orderDate ||
                order.contract.endDate < orderDate ||
                (order.contract.customerId != null && order.contract.customerId !== order.customerPartyId)
            if (contractInvalid) {
                violations.push({
                    approvalType: SalesApprovalType.EXCEPTION,
                    code: 'SALES_CONTRACT_INVALID',
                    message: `Hợp đồng ${order.contract.code} không hợp lệ cho đơn này (loại/hiệu lực/khách hàng).`,
                    detail: {
                        contractKind: order.contract.kind,
                        contractStatus: order.contract.status,
                        startDate: order.contract.startDate,
                        endDate: order.contract.endDate,
                    },
                })
            }
        } else {
            warnings.push({
                code: 'NO_SALES_CONTRACT',
                message: 'Đơn không gắn hợp đồng bán — bỏ qua kiểm tra giá sàn theo hợp đồng.',
            })
        }

        // ===== 2) Giá & chiết khấu (ContractItem.price = giá sàn, D4) =====
        if (order.contract && order.contract.kind === ContractKind.SALES) {
            for (const line of order.lines) {
                const item = order.contract.items.find((row) => row.productId === line.productId)
                if (!item) continue
                const floor = new Prisma.Decimal(item.price)
                if (line.unitPrice.lessThan(floor)) {
                    violations.push({
                        approvalType: SalesApprovalType.PRICE,
                        code: 'PRICE_BELOW_FLOOR',
                        message: `Giá bán ${line.unitPrice.toString()} của ${line.product.name} thấp hơn giá sàn hợp đồng ${floor.toString()}.`,
                        detail: {
                            lineNo: line.lineNo,
                            productId: line.productId,
                            unitPrice: line.unitPrice.toString(),
                            floorPrice: floor.toString(),
                        },
                    })
                }
                if (item.discount != null && line.discountAmount.greaterThan(new Prisma.Decimal(item.discount))) {
                    violations.push({
                        approvalType: SalesApprovalType.PRICE,
                        code: 'DISCOUNT_EXCEEDS_CONTRACT',
                        message: `Chiết khấu dòng ${line.lineNo} vượt mức hợp đồng cho phép.`,
                        detail: {
                            lineNo: line.lineNo,
                            discountAmount: line.discountAmount.toString(),
                            maxDiscount: String(item.discount),
                        },
                    })
                }
            }
        }
        const maxDiscountEnv = process.env.SALES_MAX_LINE_DISCOUNT
        if (maxDiscountEnv) {
            const maxDiscount = new Prisma.Decimal(maxDiscountEnv)
            for (const line of order.lines) {
                if (line.discountAmount.greaterThan(maxDiscount)) {
                    violations.push({
                        approvalType: SalesApprovalType.PRICE,
                        code: 'DISCOUNT_EXCEEDS_SALE_AUTHORITY',
                        message: `Chiết khấu dòng ${line.lineNo} vượt quyền của Sale (${maxDiscountEnv}).`,
                        detail: { lineNo: line.lineNo, discountAmount: line.discountAmount.toString() },
                    })
                }
            }
        }
        // Biên lợi nhuận dự kiến: doanh thu thuần so với giá vốn FIFO ước tính tại kho xuất.
        // Ngưỡng mặc định 0 nghĩa là chỉ chặn khi bán DƯỚI giá vốn — bán lỗ luôn phải có
        // người duyệt, còn đặt ngưỡng cao hơn thì cấu hình bằng SALES_MIN_MARGIN_PERCENT.
        const minMarginPercent = new Prisma.Decimal(process.env.SALES_MIN_MARGIN_PERCENT ?? '0')
        for (const line of order.lines) {
            if (!line.issueWarehouse || line.issueWarehouse.status !== MasterStatus.ACTIVE) continue
            const estimate = await this.costLayers.estimateFifoCostInTx(db, {
                warehouseId: line.issueWarehouse.id,
                productId: line.productId,
                ownerPartyId: line.issueWarehouse.legalEntity.partyId,
                qty: new Prisma.Decimal(line.orderedActualQty),
            })
            if (!estimate) {
                // Không đủ lớp giá vốn để ước tính — cảnh báo chứ không chặn, vì hàng có thể
                // về trước khi xuất.
                warnings.push({
                    code: 'MARGIN_NOT_ESTIMABLE',
                    message: `Dòng ${line.lineNo}: chưa đủ dữ liệu giá vốn để ước tính biên lợi nhuận.`,
                    detail: { lineNo: line.lineNo },
                })
                continue
            }
            const netRevenue = line.orderedActualQty.mul(line.unitPrice).minus(line.discountAmount)
            if (!netRevenue.greaterThan(0)) continue
            const marginPercent = netRevenue.minus(estimate.cost).div(netRevenue).mul(100)
            if (marginPercent.lessThan(minMarginPercent)) {
                violations.push({
                    approvalType: SalesApprovalType.PRICE,
                    code: 'MARGIN_BELOW_THRESHOLD',
                    message: `Dòng ${line.lineNo}: biên lợi nhuận dự kiến ${marginPercent.toFixed(2)}% thấp hơn mức cho phép ${minMarginPercent.toFixed(2)}%.`,
                    detail: {
                        lineNo: line.lineNo,
                        estimatedCost: estimate.cost.toString(),
                        netRevenue: netRevenue.toString(),
                        marginPercent: marginPercent.toFixed(2),
                        // Giá vốn tạm tính thì biên lợi nhuận cũng chỉ là ước lượng.
                        costIsProvisional: estimate.isProvisional,
                    },
                })
            }
        }

        // ===== 3) Công nợ (D3) =====
        const orderValue = this.orderValue(order.lines)
        const otherOrders = await db.salesOrder.findMany({
            where: {
                customerPartyId: order.customerPartyId,
                id: { not: order.id },
                kind: { in: ['SINGLE', 'LOT'] },
                status: { in: EXPOSURE_STATUSES },
            },
            select: {
                lines: {
                    select: {
                        orderedActualQty: true,
                        unitPrice: true,
                        discountAmount: true,
                        taxRate: true,
                    },
                },
            },
        })
        // Exposure = dư nợ hóa đơn chưa thu + đơn đã duyệt chưa lập hóa đơn + đơn đang xét (D3).
        const receivables = await db.receivableOpenItem.findMany({
            where: {
                customerPartyId: order.customerPartyId,
                status: { in: ['OPEN', 'PARTIALLY_SETTLED'] },
            },
            select: { outstandingAmount: true, dueDate: true },
        })
        const receivableOutstanding = receivables.reduce(
            (sum, item) => sum.plus(item.outstandingAmount),
            new Prisma.Decimal(0),
        )
        // dueDate is a DATE: an invoice due today is not yet overdue.
        const now = startOfToday()
        const overdueAmount = receivables
            .filter((item) => item.dueDate && item.dueDate < now)
            .reduce((sum, item) => sum.plus(item.outstandingAmount), new Prisma.Decimal(0))

        const exposure = otherOrders
            .reduce((sum, row) => sum.plus(this.orderValue(row.lines)), new Prisma.Decimal(0))
            .plus(orderValue)
            .plus(receivableOutstanding)

        if (overdueAmount.greaterThan(0)) {
            // Overdue debt blocks the order; only an exception approval opens it (D3).
            violations.push({
                approvalType: SalesApprovalType.CREDIT,
                code: 'CUSTOMER_HAS_OVERDUE_DEBT',
                message: `Khách hàng đang có công nợ quá hạn ${overdueAmount.toFixed(0)}.`,
                detail: { overdueAmount: overdueAmount.toString() },
            })
        }

        const tempLimitActive =
            order.customer.tempLimit != null &&
            (order.customer.tempFrom == null || order.customer.tempFrom <= now) &&
            (order.customer.tempTo == null || order.customer.tempTo >= now)
        const effectiveLimit =
            order.contract?.creditLimitOverride ??
            (tempLimitActive ? order.customer.tempLimit : null) ??
            order.customer.creditLimit

        if (order.paymentTermType === PaymentTermType.NET_DAYS && process.env.SALES_CREDIT_REVIEW_DEFERRED !== '0') {
            violations.push({
                approvalType: SalesApprovalType.CREDIT,
                code: 'DEFERRED_PAYMENT_REVIEW',
                message: `Đơn bán trả sau (${order.paymentTermDays ?? '?'} ngày) cần kế toán công nợ duyệt.`,
                detail: { paymentTermDays: order.paymentTermDays },
            })
        }
        if (effectiveLimit != null && exposure.greaterThan(new Prisma.Decimal(effectiveLimit))) {
            violations.push({
                approvalType: SalesApprovalType.CREDIT,
                code: 'CREDIT_LIMIT_EXCEEDED',
                message: `Tổng mức sử dụng tín dụng ${exposure.toFixed(0)} vượt hạn mức ${new Prisma.Decimal(effectiveLimit).toFixed(0)}.`,
                detail: {
                    exposure: exposure.toString(),
                    creditLimit: String(effectiveLimit),
                    orderValue: orderValue.toString(),
                },
            })
        }
        if (effectiveLimit == null && order.paymentTermType === PaymentTermType.NET_DAYS) {
            warnings.push({
                code: 'NO_CREDIT_LIMIT',
                message: 'Khách trả sau nhưng chưa cấu hình hạn mức công nợ.',
            })
        }

        // ===== 4) Tồn khả dụng (chỉ cảnh báo — chặn thật ở bước giữ hàng, D2 owner pháp nhân) =====
        for (const line of order.lines) {
            if (!line.issueWarehouse) continue
            if (line.issueWarehouse.status !== MasterStatus.ACTIVE) {
                violations.push({
                    approvalType: SalesApprovalType.EXCEPTION,
                    code: 'ISSUE_WAREHOUSE_INACTIVE',
                    message: `Kho xuất ${line.issueWarehouse.name} không còn hoạt động.`,
                    detail: { lineNo: line.lineNo, warehouseId: line.issueWarehouse.id },
                })
                continue
            }
            const availability = await db.inventoryAvailabilityBalance.findUnique({
                where: {
                    warehouseId_productId_ownerPartyId: {
                        warehouseId: line.issueWarehouse.id,
                        productId: line.productId,
                        ownerPartyId: line.issueWarehouse.legalEntity.partyId,
                    },
                },
            })
            const available = availability
                ? new Prisma.Decimal(availability.onHandActualQty)
                      .minus(availability.reservedActualQty)
                      .minus(availability.pendingActualQty)
                      .minus(availability.blockedActualQty)
                : new Prisma.Decimal(0)
            if (available.lessThan(line.orderedActualQty)) {
                warnings.push({
                    code: 'INSUFFICIENT_AVAILABLE_STOCK',
                    message: `Kho ${line.issueWarehouse.name} chỉ còn khả dụng ${available.toString()} cho ${line.product.name} (cần ${line.orderedActualQty.toString()}).`,
                    detail: {
                        lineNo: line.lineNo,
                        warehouseId: line.issueWarehouse.id,
                        availableQty: available.toString(),
                        requestedQty: line.orderedActualQty.toString(),
                    },
                })
            }
        }

        return {
            violations,
            warnings,
            orderValue: orderValue.toString(),
            creditExposure: exposure.toString(),
            creditLimit: effectiveLimit == null ? null : String(effectiveLimit),
        }
    }
}
