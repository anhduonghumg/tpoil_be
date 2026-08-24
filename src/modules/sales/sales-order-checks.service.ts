import { Injectable } from '@nestjs/common'
import {
    ContractKind,
    ContractStatus,
    CustomerStatus,
    MasterStatus,
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
        // Chiết khấu tính trên mỗi đơn vị: thành tiền = SL × (giá − chiết khấu).
        const net = line.orderedActualQty.mul(line.unitPrice.minus(line.discountAmount))
        if (line.taxRate == null) return net
        return net.plus(net.mul(line.taxRate))
    }

    orderValue(lines: Parameters<SalesOrderChecksService['lineValue']>[0][]) {
        return lines.reduce((sum, line) => sum.plus(this.lineValue(line)), new Prisma.Decimal(0))
    }

    /**
     * Tình hình công nợ của một khách: đã dùng bao nhiêu, hạn mức bao nhiêu, quá hạn bao nhiêu.
     *
     * Đứng riêng vì hai nơi cùng cần và không được lệch nhau: đơn bán chỉ *hiện* con số
     * (không chặn), còn phát hành hóa đơn thì *chặn* — đó mới là lúc phát sinh công nợ thật.
     *
     * `excludeOrderId` để đơn đang xét không bị đếm hai lần khi nó đã nằm trong exposure.
     */
    async creditStatus(
        db: TxOrPrisma,
        customerPartyId: string,
        options: { excludeOrderId?: string; extraExposure?: Prisma.Decimal } = {},
    ) {
        const [customer, otherOrders, receivables] = await Promise.all([
            db.party.findUniqueOrThrow({
                where: { id: customerPartyId },
                select: { creditLimit: true, tempLimit: true, tempFrom: true, tempTo: true },
            }),
            db.salesOrder.findMany({
                where: {
                    customerPartyId,
                    ...(options.excludeOrderId ? { id: { not: options.excludeOrderId } } : {}),
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
            }),
            db.receivableOpenItem.findMany({
                where: { customerPartyId, status: { in: ['OPEN', 'PARTIALLY_SETTLED'] } },
                select: { outstandingAmount: true, dueDate: true },
            }),
        ])

        const receivableOutstanding = receivables.reduce(
            (sum, item) => sum.plus(item.outstandingAmount),
            new Prisma.Decimal(0),
        )
        // dueDate là DATE: hóa đơn đến hạn hôm nay thì chưa phải quá hạn.
        const now = startOfToday()
        const overdueAmount = receivables
            .filter((item) => item.dueDate && item.dueDate < now)
            .reduce((sum, item) => sum.plus(item.outstandingAmount), new Prisma.Decimal(0))

        const exposure = otherOrders
            .reduce((sum, row) => sum.plus(this.orderValue(row.lines)), new Prisma.Decimal(0))
            .plus(options.extraExposure ?? new Prisma.Decimal(0))
            .plus(receivableOutstanding)

        const tempLimitActive =
            customer.tempLimit != null &&
            (customer.tempFrom == null || customer.tempFrom <= now) &&
            (customer.tempTo == null || customer.tempTo >= now)
        const limit = (tempLimitActive ? customer.tempLimit : null) ?? customer.creditLimit

        return { exposure, overdueAmount, receivableOutstanding, limit }
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
            // Không có hợp đồng là ngoại lệ nghiệp vụ: đơn vẫn được lưu/gửi duyệt,
            // nhưng không được tự động duyệt hay giữ tồn cho tới khi quản lý xác nhận.
            violations.push({
                approvalType: SalesApprovalType.EXCEPTION,
                code: 'NO_SALES_CONTRACT',
                message: 'Đơn chưa gắn hợp đồng bán. Cần quản lý xác nhận trước khi duyệt đơn.',
                detail: {
                    customerPartyId: order.customerPartyId,
                    orderDate: orderDate.toISOString(),
                },
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
            const netRevenue = line.orderedActualQty.mul(line.unitPrice.minus(line.discountAmount))
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

        // Công nợ KHÔNG thuộc luồng đơn bán. Kế toán công nợ xử lý ở màn xuất hóa đơn
        // (SalesInvoicesService.issue) — đó mới là lúc khoản phải thu ra đời. Ở đây không
        // kiểm, không cảnh báo, và cũng không truy vấn dư nợ để khỏi tốn 3 query mỗi lần.

        // ===== 4) Tồn khả dụng (chỉ cảnh báo — chặn thật ở bước giữ hàng, D2 owner pháp nhân) =====
        for (const line of order.lines) {
            if (!line.issueWarehouse) continue
            if (line.issueWarehouse.status !== MasterStatus.ACTIVE) {
                violations.push({
                    approvalType: SalesApprovalType.EXCEPTION,
                    code: 'ISSUE_WAREHOUSE_INACTIVE',
                    message: `Kho nhận ${line.issueWarehouse.name} không còn hoạt động.`,
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
            orderValue: this.orderValue(order.lines).toString(),
        }
    }
}
