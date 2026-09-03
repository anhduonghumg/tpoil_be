import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
    ContractKind,
    ContractStatus,
    MasterStatus,
    PaymentTermType,
    Prisma,
    SalesApprovalStatus,
    SalesApprovalType,
    SalesLotInvoiceMode,
    SalesOrderKind,
    SalesOrderSupplySource,
    SalesOrderStatus,
} from '@prisma/client'
import { createHash } from 'crypto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesOrderChecksService, SalesOrderCheckResult } from './sales-order-checks.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesOrdersService } from './sales-orders.service'
import { SalesReservationService } from './sales-reservation.service'
import { SalesDeliveriesService } from './sales-deliveries.service'
import { SalesOrderStatusService } from './sales-order-status.service'
import { SalesLotService } from './sales-lot.service'
import { SalesDiscountService } from './sales-discount.service'
import { PartyMerchantService } from 'src/modules/customers/party-merchant.service'
import { CreateSalesOrderDto, UpdateSalesOrderDto } from './dto/sales-order.dto'
import { ScopeType } from '@prisma/client'

export type SalesActor = {
    userId: string | null
    permissions?: string[]
    scopes?: Array<{ type: ScopeType; scopeId?: string | null }>
}

export const APPROVAL_TYPE_LABELS: Record<SalesApprovalType, string> = {
    STANDARD: 'đơn bán',
    PRICE: 'giá/chiết khấu',
    CREDIT: 'công nợ',
    EXCEPTION: 'ngoại lệ',
}

export const APPROVAL_TYPE_PERMISSIONS: Record<SalesApprovalType, string> = {
    STANDARD: PERMISSIONS.sales.approveOrder,
    PRICE: PERMISSIONS.sales.approvePrice,
    CREDIT: PERMISSIONS.sales.approveCredit,
    EXCEPTION: PERMISSIONS.sales.approveException,
}

const INTERNAL_KINDS: SalesOrderKind[] = [SalesOrderKind.SINGLE, SalesOrderKind.LOT]

/** Draft lifecycle + submit/recall/cancel for the internal SINGLE/LOT sales flow (spec v1.2 §4). */
@Injectable()
export class SalesOrderWorkflowService {
    private readonly logger = new Logger(SalesOrderWorkflowService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly orders: SalesOrdersService,
        private readonly checks: SalesOrderChecksService,
        private readonly events: SalesWorkflowEventsService,
        private readonly reservations: SalesReservationService,
        private readonly deliveries: SalesDeliveriesService,
        private readonly orderStatus: SalesOrderStatusService,
        private readonly lots: SalesLotService,
        private readonly discounts: SalesDiscountService,
        private readonly merchants: PartyMerchantService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private assertInternalKind(kind: SalesOrderKind) {
        if (!INTERNAL_KINDS.includes(kind)) {
            throw new BadRequestException({
                code: 'SALES_ORDER_KIND_NOT_INTERNAL',
                message: 'Thao tác này chỉ áp dụng cho đơn bán nội bộ (SINGLE/LOT).',
            })
        }
    }

    /**
     * A sale may only create an internal order when the customer has one valid
     * sales contract on the order date. Quick entry has no contract picker, so
     * the single applicable contract is attached automatically.
     */
    private async resolveContractForCreate(
        customerPartyId: string,
        orderDate: Date,
        requestedContractId?: string | null,
    ) {
        const where: Prisma.ContractWhereInput = {
            id: requestedContractId ?? undefined,
            customerId: customerPartyId,
            kind: ContractKind.SALES,
            status: ContractStatus.Active,
            deletedAt: null,
            startDate: { lte: orderDate },
            endDate: { gte: orderDate },
        }
        const contracts = await this.prisma.contract.findMany({
            where,
            orderBy: { startDate: 'desc' },
            take: requestedContractId ? 1 : 2,
            select: { id: true, code: true },
        })

        if (!contracts.length) {
            throw new BadRequestException({
                code: requestedContractId ? 'SALES_CONTRACT_INVALID' : 'SALES_CONTRACT_REQUIRED',
                message: requestedContractId
                    ? 'Hợp đồng đã chọn không hợp lệ cho khách hàng hoặc ngày lập đơn.'
                    : 'Khách hàng chưa có hợp đồng bán đang hiệu lực. Không thể tạo đơn.',
                detail: { customerPartyId, orderDate: orderDate.toISOString() },
            })
        }
        if (!requestedContractId && contracts.length > 1) {
            throw new BadRequestException({
                code: 'SALES_CONTRACT_AMBIGUOUS',
                message: 'Khách hàng có nhiều hợp đồng bán cùng hiệu lực. Cần xử lý lại dữ liệu hợp đồng trước khi tạo đơn.',
                detail: { customerPartyId, contractCodes: contracts.map((contract) => contract.code) },
            })
        }
        return contracts[0].id
    }

    private linesCreateInput(
        dto: CreateSalesOrderDto | UpdateSalesOrderDto,
        orderKind?: SalesOrderKind,
    ) {
        return (dto.lines ?? []).map((line, index) => {
            // Các client cũ chỉ gửi discountAmount; coi đó là CK gốc để vẫn đọc được
            // đúng nghiệp vụ sau khi tách CK/CKDC.
            const discountBaseAmount = new Prisma.Decimal(
                line.discountBaseAmount ?? line.discountAmount ?? 0,
            )
            const discountAdjustmentAmount = new Prisma.Decimal(line.discountAdjustmentAmount ?? 0)
            const discountAmount = discountBaseAmount.plus(discountAdjustmentAmount)
            if (discountAmount.lessThan(0)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_FINAL_DISCOUNT_NEGATIVE',
                    message: 'CK cuối không được nhỏ hơn 0.',
                })
            }

            return {
                lineNo: index + 1,
                productId: line.productId,
                issueWarehouseId: line.issueWarehouseId ?? null,
                receivingWarehouseId: line.receivingWarehouseId ?? null,
                receivingWarehouseAreaId: line.receivingWarehouseAreaId ?? null,
                orderedActualQty: new Prisma.Decimal(line.orderedActualQty),
                orderedV15Qty: line.orderedV15Qty == null ? null : new Prisma.Decimal(line.orderedV15Qty),
                unitPrice: new Prisma.Decimal(line.unitPrice ?? 0),
                discountBaseAmount,
                discountAdjustmentAmount,
                discountAmount,
                supplySource: line.supplySource ?? SalesOrderSupplySource.TP,
                // Đơn đặt lô chỉ chốt hàng và điều khoản; xe/lái xe được khai ở từng phiếu rút.
                vehiclePlate:
                    orderKind === SalesOrderKind.LOT ? null : line.vehiclePlate?.trim() || null,
                driverName:
                    orderKind === SalesOrderKind.LOT ? null : line.driverName?.trim() || null,
                taxRate: line.taxRate == null ? null : new Prisma.Decimal(line.taxRate),
                note: line.note?.trim() || null,
            }
        })
    }

    private paymentSchedule(
        dto: CreateSalesOrderDto | UpdateSalesOrderDto,
        orderDate: Date,
    ) {
        const termType = (dto.paymentTermType as PaymentTermType | undefined) ?? PaymentTermType.SAME_DAY
        if (termType === PaymentTermType.SAME_DAY) {
            if (dto.paymentPlans?.length) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_NOT_APPLICABLE',
                    message: 'Thanh toán trong ngày không được khai thêm lịch thanh toán.',
                })
            }
            return { paymentTermDays: null, plans: [] }
        }

        const sourcePlans = dto.paymentPlans?.length
            ? dto.paymentPlans
            : dto.paymentTermDays
              ? [
                    {
                        dueDate: new Date(orderDate.getTime() + dto.paymentTermDays * 86_400_000)
                            .toISOString()
                            .slice(0, 10),
                        percent: 100,
                    },
                ]
              : []
        if (!sourcePlans.length) {
            throw new BadRequestException({
                code: 'PAYMENT_PLAN_REQUIRED',
                message: 'Thanh toán theo lịch phải có ít nhất một đợt thanh toán.',
            })
        }

        let percentTotal = new Prisma.Decimal(0)
        let amountTotal = new Prisma.Decimal(0)
        let usesPercent = false
        let usesAmount = false
        const orderDay = new Date(`${orderDate.toISOString().slice(0, 10)}T00:00:00.000Z`)
        const plans = sourcePlans.map((plan, index) => {
            if (!plan.dueDate) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_DUE_DATE_REQUIRED',
                    message: `Đợt thanh toán ${index + 1} chưa có ngày thanh toán.`,
                })
            }
            const dueDate = new Date(`${plan.dueDate.slice(0, 10)}T00:00:00.000Z`)
            if (Number.isNaN(dueDate.getTime()) || dueDate < orderDay) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_DUE_DATE_INVALID',
                    message: `Ngày thanh toán đợt ${index + 1} không được trước ngày đặt hàng.`,
                })
            }

            const hasPercent = plan.percent != null
            const hasAmount = plan.amount != null
            if (hasPercent === hasAmount) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_VALUE_INVALID',
                    message: `Đợt thanh toán ${index + 1} phải nhập đúng một giá trị tỷ lệ hoặc số tiền.`,
                })
            }
            const percent = hasPercent ? new Prisma.Decimal(plan.percent!) : null
            const amount = hasAmount ? new Prisma.Decimal(plan.amount!) : null
            if ((percent && !percent.greaterThan(0)) || (amount && !amount.greaterThan(0))) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_VALUE_INVALID',
                    message: `Giá trị đợt thanh toán ${index + 1} phải lớn hơn 0.`,
                })
            }
            if (percent && percent.greaterThan(100)) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_PERCENT_INVALID',
                    message: `Tỷ lệ đợt thanh toán ${index + 1} không được lớn hơn 100%.`,
                })
            }
            if (percent) {
                usesPercent = true
                percentTotal = percentTotal.plus(percent)
            }
            if (amount) {
                usesAmount = true
                amountTotal = amountTotal.plus(amount)
            }
            return {
                dueDate,
                percent,
                amount,
                note: plan.note?.trim() || null,
                sortOrder: index,
            }
        })

        if (usesPercent && usesAmount) {
            throw new BadRequestException({
                code: 'PAYMENT_PLAN_MIXED_VALUE_TYPES',
                message: 'Một lịch thanh toán chỉ được dùng tỷ lệ hoặc số tiền, không trộn hai cách.',
            })
        }
        if (usesPercent && !percentTotal.equals(100)) {
            throw new BadRequestException({
                code: 'PAYMENT_PLAN_PERCENT_TOTAL_INVALID',
                message: `Tổng tỷ lệ lịch thanh toán phải bằng 100% (hiện tại ${percentTotal.toString()}%).`,
            })
        }
        if (usesAmount) {
            const orderTotal = (dto.lines ?? []).reduce((sum, line) => {
                const qty = new Prisma.Decimal(line.orderedActualQty ?? 0)
                const price = new Prisma.Decimal(line.unitPrice ?? 0)
                const discount = new Prisma.Decimal(
                    line.discountBaseAmount ?? line.discountAmount ?? 0,
                ).plus(line.discountAdjustmentAmount ?? 0)
                return sum.plus(qty.mul(price.minus(discount)))
            }, new Prisma.Decimal(0))
            if (!amountTotal.equals(orderTotal)) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_AMOUNT_TOTAL_INVALID',
                    message: 'Tổng tiền các đợt thanh toán phải bằng giá trị đơn hàng.',
                })
            }
        }

        const paymentTermDays = Math.max(
            ...plans.map((plan) => Math.round((plan.dueDate.getTime() - orderDay.getTime()) / 86_400_000)),
        )
        return { paymentTermDays, plans }
    }

    /**
     * Pháp nhân bán không phải dữ liệu Sale nhập — kho xuất thuộc đúng một pháp
     * nhân nên hệ thống suy ra từ đó (spec v1.2 §8.1: một đơn = một pháp nhân).
     */
    private async resolveLegalEntityId(dto: CreateSalesOrderDto) {
        const warehouseIds = [
            ...new Set((dto.lines ?? []).map((line) => line.issueWarehouseId).filter(Boolean)),
        ] as string[]
        const areaIds = [
            ...new Set(
                (dto.lines ?? []).map((line) => line.receivingWarehouseAreaId).filter(Boolean),
            ),
        ] as string[]
        for (const [index, line] of (dto.lines ?? []).entries()) {
            if (Boolean(line.issueWarehouseId) === Boolean(line.receivingWarehouseAreaId)) {
                throw new BadRequestException({
                    code: 'RECEIVING_SCOPE_REQUIRED',
                    message: `Dòng ${index + 1} phải chọn đúng một kho nhận: khu vực hoặc kho cụ thể.`,
                })
            }
        }
        if (!warehouseIds.length && !areaIds.length) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_REQUIRED',
                message: 'Đơn bán nội bộ phải chọn kho nhận cho từng dòng.',
            })
        }
        const [warehouses, areas] = await Promise.all([
            this.prisma.warehouse.findMany({
                where: { id: { in: warehouseIds }, status: MasterStatus.ACTIVE },
                select: { id: true, legalEntityId: true },
            }),
            this.prisma.warehouseArea.findMany({
                where: { id: { in: areaIds }, status: MasterStatus.ACTIVE },
                select: {
                    id: true,
                    warehouses: {
                        where: { status: MasterStatus.ACTIVE, isOperationalWarehouse: true },
                        select: { legalEntityId: true },
                    },
                },
            }),
        ])
        if (warehouses.length !== warehouseIds.length) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_INVALID',
                message: 'Kho xuất không tồn tại hoặc không hoạt động.',
            })
        }
        if (areas.length !== areaIds.length || areas.some((area) => !area.warehouses.length)) {
            throw new BadRequestException({
                code: 'RECEIVING_WAREHOUSE_AREA_INVALID',
                message: 'Khu vực nhận không tồn tại hoặc chưa có kho vận hành.',
            })
        }
        const legalEntityIds = [
            ...new Set([
                ...warehouses.map((row) => row.legalEntityId),
                ...areas.flatMap((area) => area.warehouses.map((row) => row.legalEntityId)),
            ]),
        ]
        if (legalEntityIds.length > 1) {
            throw new BadRequestException({
                code: 'ISSUE_WAREHOUSE_LEGAL_ENTITY_MISMATCH',
                message: 'Các kho xuất thuộc nhiều pháp nhân khác nhau — phải tách thành nhiều đơn.',
            })
        }
        return legalEntityIds[0]
    }

    async createInternal(dto: CreateSalesOrderDto, actor: SalesActor) {
        const kind = dto.kind as SalesOrderKind
        this.assertInternalKind(kind)
        const legalEntityId = await this.resolveLegalEntityId(dto)
        const [customer, legalEntity] = await Promise.all([
            this.prisma.party.findUnique({
                where: { id: dto.customerPartyId },
                select: { id: true, name: true },
            }),
            this.prisma.legalEntity.findUnique({
                where: { id: legalEntityId },
                select: { id: true, baseCurrency: true },
            }),
        ])
        if (!customer) throw new BadRequestException('CUSTOMER_NOT_FOUND')
        if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_FOUND')

        const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date()
        if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')
        if (!dto.lines?.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')
        // Chặn ngay, không để đơn lưu xong rồi mới kẹt im ở nháp vì thiếu công bố giá.
        await this.assertDiscountsAnnounced(
            dto.lines.map((line, index) => ({ lineNo: index + 1, ...line })),
            legalEntityId,
        )
        const contractId = await this.resolveContractForCreate(
            dto.customerPartyId,
            orderDate,
            dto.contractId,
        )
        const paymentSchedule = this.paymentSchedule(dto, orderDate)

        const orderNo = await this.orders.generateOrderNo(dto.customerPartyId, orderDate)

        const created = await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.create({
                data: {
                    legalEntityId: legalEntity.id,
                    orderNo,
                    customerPartyId: dto.customerPartyId,
                    kind,
                    status: SalesOrderStatus.DRAFT,
                    orderDate,
                    currency: legalEntity.baseCurrency || 'VND',
                    note: dto.note?.trim() || null,
                    contractId,
                    // DB CHECK: chỉ đơn lô mới có trường này, và đơn lô thì bắt buộc có.
                    lotInvoiceMode:
                        kind === SalesOrderKind.LOT
                            ? ((dto.lotInvoiceMode as SalesLotInvoiceMode) ??
                              SalesLotInvoiceMode.ON_WITHDRAWAL)
                            : null,
                    paymentTermType: (dto.paymentTermType as PaymentTermType) ?? PaymentTermType.SAME_DAY,
                    paymentTermDays: paymentSchedule.paymentTermDays,
                    paymentPlans: paymentSchedule.plans.length
                        ? { create: paymentSchedule.plans }
                        : undefined,
                    createdById: actor.userId,
                    lines: { create: this.linesCreateInput(dto, kind) },
                },
                select: { id: true, status: true },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: order.id,
                eventType: 'CREATE',
                toStatus: order.status,
                actorId: actor.userId,
                metadata: { kind },
            })
            return order
        })

        // Sales asked to drop the draft limbo: a new order goes straight to review, and
        // submit() decides whether it needs an exception approval or can auto-confirm.
        await this.submitQuietly(created.id, actor)
        return this.orders.detail(created.id)
    }

    /**
     * Submitting must never lose an order that was already written. If it is not yet
     * submittable the order simply stays a draft for the author to finish.
     */
    private async submitQuietly(id: string, actor: SalesActor) {
        try {
            await this.submit(id, actor)
        } catch (error) {
            this.logger.warn(
                `Đơn ${id} chưa gửi kiểm duyệt được, giữ ở nháp: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            )
        }
    }

    async updateDraft(id: string, dto: UpdateSalesOrderDto, actor: SalesActor) {
        // An order waiting for review is still the author's to fix; editing it just
        // starts a fresh approval cycle rather than forcing a recall first.
        let wasPendingReview = false

        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: {
                    id: true,
                    kind: true,
                    status: true,
                    version: true,
                    orderDate: true,
                    legalEntityId: true,
                    paymentTermType: true,
                    paymentTermDays: true,
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            const editable: SalesOrderStatus[] = [
                SalesOrderStatus.DRAFT,
                SalesOrderStatus.REJECTED,
                SalesOrderStatus.PENDING_REVIEW,
            ]
            if (!editable.includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_EDITABLE',
                    message: 'Chỉ sửa được đơn khi còn nháp, đang chờ duyệt hoặc bị từ chối.',
                })
            }
            wasPendingReview = order.status === SalesOrderStatus.PENDING_REVIEW

            const data: Prisma.SalesOrderUpdateInput = {
                status: SalesOrderStatus.DRAFT,
                version: { increment: 1 },
            }
            if (dto.orderDate !== undefined) {
                const orderDate = new Date(dto.orderDate)
                if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')
                data.orderDate = orderDate
            }
            if (dto.note !== undefined) data.note = dto.note?.trim() || null
            if (dto.contractId !== undefined) {
                data.contract = dto.contractId
                    ? { connect: { id: dto.contractId } }
                    : { disconnect: true }
            }
            const rebuildPaymentSchedule =
                dto.paymentPlans !== undefined ||
                dto.paymentTermType !== undefined ||
                dto.paymentTermDays !== undefined
            if (rebuildPaymentSchedule) {
                const effectiveOrderDate = dto.orderDate ? new Date(dto.orderDate) : order.orderDate
                const schedule = this.paymentSchedule(
                    {
                        ...dto,
                        paymentTermType: dto.paymentTermType ?? order.paymentTermType,
                        paymentTermDays:
                            dto.paymentTermDays === undefined ? (order.paymentTermDays ?? undefined) : dto.paymentTermDays ?? undefined,
                    },
                    effectiveOrderDate,
                )
                data.paymentTermType =
                    (dto.paymentTermType as PaymentTermType | undefined) ?? order.paymentTermType
                data.paymentTermDays = schedule.paymentTermDays
                await tx.salesOrderPaymentPlan.deleteMany({ where: { salesOrderId: id } })
                if (schedule.plans.length) {
                    await tx.salesOrderPaymentPlan.createMany({
                        data: schedule.plans.map((plan) => ({ ...plan, salesOrderId: id })),
                    })
                }
            }
            if (dto.lotInvoiceMode !== undefined) {
                if (order.kind !== SalesOrderKind.LOT) {
                    throw new BadRequestException({
                        code: 'LOT_INVOICE_MODE_NOT_APPLICABLE',
                        message: 'Chỉ đơn lô mới chọn được cách xuất hóa đơn.',
                    })
                }
                data.lotInvoiceMode = dto.lotInvoiceMode as SalesLotInvoiceMode
            }

            await tx.salesOrder.update({ where: { id }, data })

            if (dto.lines) {
                if (!dto.lines.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')
                // Cùng luật như lúc tạo: sửa xong mà vẫn thiếu công bố giá thì chặn tại
                // đây, đừng để đơn lưu được rồi lại kẹt im ở nháp.
                await this.assertDiscountsAnnounced(
                    dto.lines.map((line, index) => ({ lineNo: index + 1, ...line })),
                    order.legalEntityId,
                    tx,
                )
                await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } })
                await tx.salesOrderLine.createMany({
                    data: this.linesCreateInput(dto, order.kind).map((line) => ({
                        ...line,
                        salesOrderId: id,
                    })),
                })
            }

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'UPDATE',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.DRAFT,
                actorId: actor.userId,
                version: order.version + 1,
            })
        })

        // The edit dropped it back to draft; put it straight back under review so the
        // author never has to remember to resubmit.
        if (wasPendingReview) await this.submitQuietly(id, actor)
        return this.orders.detail(id)
    }

    async deleteDraft(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: {
                    id: true,
                    kind: true,
                    status: true,
                    _count: { select: { approvalRequests: true } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.DRAFT) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_DRAFT',
                    message: 'Chỉ xóa được đơn nháp.',
                })
            }
            if (order._count.approvalRequests > 0) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_HAS_HISTORY',
                    message: 'Đơn đã có lịch sử kiểm duyệt — hãy hủy đơn thay vì xóa.',
                })
            }
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'DELETE',
                fromStatus: order.status,
                actorId: actor.userId,
            })
            await tx.salesOrderLine.deleteMany({ where: { salesOrderId: id } })
            await tx.salesOrder.delete({ where: { id } })
        })
        return { success: true }
    }

    /** Snapshot of prices/terms/checks captured at submit (spec v1.2 §7.3). */
    private buildPolicySnapshot(
        order: {
            approvalCycle: number
            paymentTermType: PaymentTermType
            paymentTermDays: number | null
            contractId: string | null
            contract: { updatedAt: Date } | null
            lines: Array<{
                lineNo: number
                productId: string
                orderedActualQty: Prisma.Decimal
                unitPrice: Prisma.Decimal
                discountAmount: Prisma.Decimal
                taxRate: Prisma.Decimal | null
            }>
        },
        checkResult: SalesOrderCheckResult,
        cycle: number,
    ): Prisma.InputJsonObject {
        const payload = {
            approvalCycle: cycle,
            paymentTermType: order.paymentTermType,
            paymentTermDays: order.paymentTermDays,
            contractId: order.contractId,
            contractUpdatedAt: order.contract?.updatedAt?.toISOString() ?? null,
            lines: order.lines.map((line) => ({
                lineNo: line.lineNo,
                productId: line.productId,
                orderedActualQty: line.orderedActualQty.toString(),
                unitPrice: line.unitPrice.toString(),
                discountAmount: line.discountAmount.toString(),
                taxRate: line.taxRate?.toString() ?? null,
            })),
            checks: {
                orderValue: checkResult.orderValue,
                violations: checkResult.violations.map((violation) => ({
                    approvalType: violation.approvalType,
                    code: violation.code,
                    message: violation.message,
                })),
                warnings: checkResult.warnings.map((warning) => ({
                    code: warning.code,
                    message: warning.message,
                })),
            },
            capturedAt: new Date().toISOString(),
        }
        const policyHash = createHash('md5').update(JSON.stringify(payload)).digest('hex')
        return { ...payload, policyHash } as unknown as Prisma.InputJsonObject
    }

    /**
     * "Phải có thông báo chiết khấu thì mới cho bán hàng" (docs/thongbaogia.md §1).
     *
     * Chặn ngay từ lúc lưu chứ không đợi tới bước gửi duyệt: đơn lưu được rồi mới hỏng ở
     * submit thì lỗi bị submitQuietly nuốt (cố tình, để không mất đơn), Sale tưởng đã xong
     * mà đơn nằm im ở nháp. Dùng chung một hàm cho cả lúc lưu lẫn lúc gửi duyệt để hai nơi
     * không bao giờ nói khác nhau.
     *
     * Dòng chốt tới khu vực thì chỉ cần MỘT kho vận hành trong khu vực đã có công bố.
     */
    private async assertDiscountsAnnounced(
        lines: Array<{
            lineNo: number
            productId: string
            issueWarehouseId?: string | null
            receivingWarehouseAreaId?: string | null
        }>,
        legalEntityId: string,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ) {
        const areaIds = [
            ...new Set(lines.map((line) => line.receivingWarehouseAreaId).filter(Boolean)),
        ] as string[]
        const areas = areaIds.length
            ? await db.warehouseArea.findMany({
                  where: { id: { in: areaIds } },
                  select: {
                      id: true,
                      name: true,
                      warehouses: {
                          where: {
                              status: MasterStatus.ACTIVE,
                              isOperationalWarehouse: true,
                              legalEntityId,
                          },
                          select: { id: true },
                      },
                  },
              })
            : []
        const areaById = new Map(areas.map((area) => [area.id, area]))
        const candidatesOf = (line: (typeof lines)[number]) =>
            line.issueWarehouseId
                ? [line.issueWarehouseId]
                : (areaById.get(line.receivingWarehouseAreaId!)?.warehouses ?? []).map(
                      (warehouse) => warehouse.id,
                  )

        const announced = await this.discounts.resolveDiscounts(
            lines.flatMap((line) =>
                candidatesOf(line).map((warehouseId) => ({ warehouseId, productId: line.productId })),
            ),
            new Date(),
            db,
        )
        const failing = lines.filter(
            (line) =>
                !candidatesOf(line).some((warehouseId) =>
                    announced.has(`${warehouseId}:${line.productId}`),
                ),
        )
        if (!failing.length) return

        // Chỉ tra tên cho những dòng hỏng — thông báo phải chỉ đúng mặt hàng và nơi nhận.
        const [products, warehouses] = await Promise.all([
            db.product.findMany({
                where: { id: { in: [...new Set(failing.map((line) => line.productId))] } },
                select: { id: true, code: true, name: true },
            }),
            db.warehouse.findMany({
                where: {
                    id: {
                        in: [
                            ...new Set(failing.map((line) => line.issueWarehouseId).filter(Boolean)),
                        ] as string[],
                    },
                },
                select: { id: true, name: true },
            }),
        ])
        const productById = new Map(products.map((row) => [row.id, row]))
        const warehouseById = new Map(warehouses.map((row) => [row.id, row]))
        const detail = failing.map((line) => {
            const product = productById.get(line.productId)
            const location = line.issueWarehouseId
                ? (warehouseById.get(line.issueWarehouseId)?.name ?? '')
                : `khu vực ${areaById.get(line.receivingWarehouseAreaId!)?.name ?? ''}`
            return {
                lineNo: line.lineNo,
                productId: line.productId,
                productCode: product?.code ?? null,
                warehouseId: line.issueWarehouseId ?? null,
                warehouseAreaId: line.receivingWarehouseAreaId ?? null,
                text: `dòng ${line.lineNo} (${product?.code ?? product?.name ?? ''} tại ${location})`,
            }
        })
        throw new BadRequestException({
            code: 'DISCOUNT_NOT_ANNOUNCED',
            message: `Chưa có thông báo chiết khấu cho ${detail
                .map((row) => row.text)
                .join('; ')} — vận hành phải ra thông báo trước khi bán.`,
            detail: { lines: detail },
        })
    }

    private async validateSubmittable(
        tx: Prisma.TransactionClient,
        order: {
            id: string
            kind: SalesOrderKind
            legalEntityId: string
            customerPartyId: string
            orderDate: Date
            lines: Array<{
                lineNo: number
                productId: string
                issueWarehouseId: string | null
                receivingWarehouseAreaId: string | null
                unitPrice: Prisma.Decimal
                vehiclePlate: string | null
                driverName: string | null
            }>
        },
    ) {
        if (!order.lines.length) throw new BadRequestException('SALES_ORDER_LINES_REQUIRED')
        for (const line of order.lines) {
            if (Boolean(line.issueWarehouseId) === Boolean(line.receivingWarehouseAreaId)) {
                throw new BadRequestException({
                    code: 'RECEIVING_SCOPE_REQUIRED',
                    message: `Dòng ${line.lineNo} phải chọn đúng một khu vực hoặc kho nhận cụ thể.`,
                })
            }
            if (!line.unitPrice.greaterThan(0)) {
                throw new BadRequestException({
                    code: 'UNIT_PRICE_REQUIRED',
                    message: `Dòng ${line.lineNo} chưa có giá bán.`,
                })
            }
            if (order.kind === SalesOrderKind.SINGLE && (!line.vehiclePlate || !line.driverName)) {
                throw new BadRequestException({
                    code: 'VEHICLE_DRIVER_REQUIRED',
                    message: `Đơn lấy 1 lần: dòng ${line.lineNo} phải có BKS và lái xe.`,
                })
            }
        }
        const warehouseIds = [
            ...new Set(order.lines.map((line) => line.issueWarehouseId).filter(Boolean)),
        ] as string[]
        const areaIds = [
            ...new Set(order.lines.map((line) => line.receivingWarehouseAreaId).filter(Boolean)),
        ] as string[]
        const [warehouses, areas] = await Promise.all([
            tx.warehouse.findMany({
                where: { id: { in: warehouseIds } },
                select: { id: true, name: true, status: true, legalEntityId: true, areaId: true },
            }),
            tx.warehouseArea.findMany({
                where: { id: { in: areaIds }, status: MasterStatus.ACTIVE },
                select: {
                    id: true,
                    name: true,
                    warehouses: {
                        where: {
                            status: MasterStatus.ACTIVE,
                            isOperationalWarehouse: true,
                            legalEntityId: order.legalEntityId,
                        },
                        select: { id: true, name: true, legalEntityId: true },
                    },
                },
            }),
        ])
        const byId = new Map(warehouses.map((row) => [row.id, row]))
        const areaById = new Map(areas.map((row) => [row.id, row]))
        for (const warehouseId of warehouseIds) {
            const warehouse = byId.get(warehouseId)
            if (!warehouse || warehouse.status !== MasterStatus.ACTIVE) {
                throw new BadRequestException({
                    code: 'ISSUE_WAREHOUSE_INVALID',
                    message: 'Kho nhận không tồn tại hoặc không hoạt động.',
                })
            }
            // Spec v1.2 §8.1 (review 8.1): one order = one invoice = one legal entity.
            if (warehouse.legalEntityId !== order.legalEntityId) {
                throw new BadRequestException({
                    code: 'ISSUE_WAREHOUSE_LEGAL_ENTITY_MISMATCH',
                    message: `Kho ${warehouse.name} không thuộc pháp nhân của đơn bán.`,
                })
            }
            if (!warehouse.areaId) {
                throw new BadRequestException({
                    code: 'RECEIVING_WAREHOUSE_AREA_REQUIRED',
                    message: `Kho nhận ${warehouse.name} chưa được gán khu vực.`,
                    detail: { warehouseId },
                })
            }
        }
        for (const areaId of areaIds) {
            const area = areaById.get(areaId)
            if (!area?.warehouses.length) {
                throw new BadRequestException({
                    code: 'RECEIVING_WAREHOUSE_AREA_INVALID',
                    message: `Khu vực nhận ${area?.name ?? ''} chưa có kho vận hành phù hợp với pháp nhân của đơn.`,
                    detail: { areaId },
                })
            }
        }

        // Chỉ bán cho TNPP (mua bán hai chiều) và TNDL (chỉ bán cho họ). Xét theo phân
        // loại TẠI NGÀY ĐƠN, vì một đối tác có thể đổi loại theo thời gian.
        await this.merchants.assertCanTrade(order.customerPartyId, 'SELL', order.orderDate, tx)

        // "Phải có chiết khấu thì mới cho bán hàng" (docs/thongbaogia.md §1): kho hoặc mặt
        // hàng chưa nằm trong bảng chiết khấu đang hiệu lực thì chặn ngay, không cho gửi.
        //
        // Tra theo THỜI ĐIỂM gửi duyệt, không phải orderDate: orderDate là cột DATE nên
        // luôn là 00:00, mà chiết khấu thì đổi trong ngày (14h, 17h...). Lấy orderDate sẽ
        // khiến bản công bố lúc 14h không bao giờ áp cho đơn cùng ngày.
        await this.assertDiscountsAnnounced(order.lines, order.legalEntityId, tx)
    }

    async submit(id: string, actor: SalesActor) {
        const result = await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { id: true, name: true } },
                    contract: { select: { updatedAt: true } },
                    lines: true,
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.DRAFT) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_SUBMITTABLE',
                    message: 'Chỉ gửi kiểm duyệt được từ trạng thái nháp.',
                })
            }
            await this.validateSubmittable(tx, order)

            const cycle = order.approvalCycle + 1
            // Resubmission after recall/reject: anything still pending from older cycles is stale.
            await tx.salesApprovalRequest.updateMany({
                where: { salesOrderId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.STALE },
            })

            const checkResult = await this.checks.run(tx, id)
            const policySnapshot = this.buildPolicySnapshot(order, checkResult, cycle)
            const violatedTypes = [...new Set(checkResult.violations.map((row) => row.approvalType))]
            const now = new Date()

            // Mọi đơn Sale nhập lên đều phải qua quản lý ký — không còn tự duyệt. Đơn
            // không vi phạm gì vẫn sinh một yêu cầu STANDARD để có người chịu trách nhiệm.
            const requiredTypes = violatedTypes.length
                ? violatedTypes
                : [SalesApprovalType.STANDARD]

            for (const type of requiredTypes) {
                await tx.salesApprovalRequest.create({
                    data: {
                        salesOrderId: id,
                        approvalCycle: cycle,
                        type,
                        status: SalesApprovalStatus.PENDING,
                        requestedById: actor.userId,
                        reasonDetail: {
                            violations: checkResult.violations
                                .filter((row) => row.approvalType === type)
                                .map((row) => ({ code: row.code, message: row.message, detail: row.detail })),
                        } as unknown as Prisma.InputJsonObject,
                    },
                })
            }

            const nextStatus = SalesOrderStatus.PENDING_REVIEW
            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: nextStatus,
                    approvalCycle: cycle,
                    submittedAt: now,
                    submittedById: actor.userId,
                    policySnapshot,
                    rejectedReason: null,
                    version: { increment: 1 },
                },
            })

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'SUBMIT',
                fromStatus: order.status,
                toStatus: nextStatus,
                actorId: actor.userId,
                cycle,
                metadata: {
                    violations: checkResult.violations.map((row) => row.code),
                    warnings: checkResult.warnings.map((row) => row.code),
                },
            })

            for (const type of requiredTypes) {
                const reasonSummary = checkResult.violations
                    .filter((row) => row.approvalType === type)
                    .map((row) => row.message)
                    .join(' ')
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.ORDER_REVIEW_REQUESTED,
                        aggregateType: 'SALES_ORDER',
                        aggregateId: id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_REVIEW_REQUESTED}:${id}:cycle${cycle}:${type}`,
                        payload: {
                            entityType: 'SALES_ORDER',
                            entityId: id,
                            workItemSourceType: 'SALES_ORDER_APPROVAL',
                            workItemSourceId: `${id}:${type}`,
                            actionRequired: true,
                            orderNo: order.orderNo,
                            customerName: order.customer.name,
                            approvalType: type,
                            approvalTypeLabel: APPROVAL_TYPE_LABELS[type],
                            reasonSummary,
                            cycle,
                            recipientPermissionCodes: [APPROVAL_TYPE_PERMISSIONS[type]],
                            excludeUserIds: actor.userId ? [actor.userId] : [],
                        },
                    },
                    tx,
                )
            }
            return { checkResult }
        })

        const detail = await this.orders.detail(id)
        // autoApproved giữ lại cho client cũ, nhưng nay luôn false: không còn tự duyệt.
        return { ...detail, submitResult: result.checkResult, autoApproved: false }
    }

    /** Shared by auto-approve at submit and by the last manual approval (SalesApprovalsService). */
    async emitOrderApproved(
        tx: Prisma.TransactionClient,
        args: {
            orderId: string
            orderNo: string
            customerName: string
            recipientUserIds: string[]
            cycle: number
        },
    ) {
        await this.notificationOutbox.emit(
            {
                eventType: SALES_NOTIFICATION_EVENTS.ORDER_APPROVED,
                aggregateType: 'SALES_ORDER',
                aggregateId: args.orderId,
                dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_APPROVED}:${args.orderId}:cycle${args.cycle}`,
                payload: {
                    entityType: 'SALES_ORDER',
                    entityId: args.orderId,
                    orderNo: args.orderNo,
                    customerName: args.customerName,
                    cycle: args.cycle,
                    recipientUserIds: args.recipientUserIds,
                },
            },
            tx,
        )
    }

    /**
     * What an approved order does next depends on its kind: a LOT order only opens its draw
     * balances, a SINGLE order goes straight to holding stock and dispatching the warehouses.
     */
    async onApproved(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor) {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            select: { kind: true },
        })
        // Duyệt là cam kết thực hiện đơn, nên thiếu tồn phải chặn ngay tại đây. Việc kiểm
        // tra lại khi giữ hàng phía dưới vẫn cần thiết để chống trường hợp hai đơn duyệt sát nhau.
        const stockWarnings = (await this.checks.run(tx, orderId)).warnings.filter(
            (warning) => warning.code === 'INSUFFICIENT_AVAILABLE_STOCK',
        )
        if (stockWarnings.length) {
            throw new BadRequestException({
                code: 'INSUFFICIENT_AVAILABLE_STOCK',
                message: `Không thể duyệt vì tồn kho chưa đủ: ${stockWarnings.map((warning) => warning.message).join('; ')}`,
                details: stockWarnings,
            })
        }
        if (order.kind === SalesOrderKind.LOT) {
            // Đơn lô là cam kết cả lô cho khách: giữ đủ ngay khi duyệt. Khi khách rút,
            // lượng giữ này được chuyển sang yêu cầu rút chứ không giữ trùng lần hai.
            const outcome = await this.reservations.reserveOrder(tx, orderId, actor)
            if (!outcome.fullyReserved) {
                throw new BadRequestException({
                    code: 'INSUFFICIENT_AVAILABLE_STOCK',
                    message: `Không thể duyệt vì tồn kho chưa đủ: ${outcome.lines
                        .filter((line) => !new Prisma.Decimal(line.shortageQty).isZero())
                        .map((line) => `${line.productName} tại ${line.warehouseName} thiếu ${line.shortageQty}`)
                        .join('; ')}`,
                    details: outcome.lines,
                })
            }
            await this.lots.openPositions(tx, orderId)
            return outcome
        }
        const outcome = await this.reserveAndDispatch(tx, orderId, actor)
        if (!outcome.fullyReserved) {
            throw new BadRequestException({
                code: 'INSUFFICIENT_AVAILABLE_STOCK',
                message: `Không thể duyệt vì tồn kho chưa đủ: ${outcome.lines
                    .filter((line) => !new Prisma.Decimal(line.shortageQty).isZero())
                    .map((line) => `${line.productName} tại ${line.warehouseName} thiếu ${line.shortageQty}`)
                    .join('; ')}`,
                details: outcome.lines,
            })
        }
        return outcome
    }

    /**
     * Approval does not touch stock — it triggers the hold, and a fully held order is
     * dispatched to the warehouses straight away (spec v1.2 §4.1, §8.1). Never throws on
     * shortage: the order parks at PARTIALLY_RESERVED/AWAITING_STOCK and sales can retry.
     */
    async reserveAndDispatch(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor) {
        const outcome = await this.reservations.reserveOrder(tx, orderId, actor)
        if (outcome.fullyReserved) {
            await this.deliveries.createForOrder(tx, orderId, actor)
        } else if (outcome.lines.length) {
            const order = await tx.salesOrder.findUniqueOrThrow({
                where: { id: orderId },
                select: {
                    orderNo: true,
                    createdById: true,
                    submittedById: true,
                    version: true,
                    customer: { select: { name: true } },
                },
            })
            const shortages = outcome.lines.filter((line) => !new Prisma.Decimal(line.shortageQty).isZero())
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT,
                    aggregateType: 'SALES_ORDER',
                    aggregateId: orderId,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_STOCK_INSUFFICIENT}:${orderId}:v${order.version}`,
                    payload: {
                        entityType: 'SALES_ORDER',
                        entityId: orderId,
                        orderNo: order.orderNo,
                        customerName: order.customer.name,
                        shortageSummary: shortages
                            .map(
                                (line) =>
                                    `${line.productName} tại ${line.warehouseName}: thiếu ${line.shortageQty}`,
                            )
                            .join('; '),
                        recipientUserIds: [order.createdById, order.submittedById].filter(
                            (value): value is string => !!value,
                        ),
                        recipientPermissionCodes: [PERMISSIONS.sales.deliveryConfirm],
                    },
                },
                tx,
            )
        }
        await this.orderStatus.recompute(tx, orderId)
        return outcome
    }

    /**
     * Reopens an already-approved order for approval again. This is deliberately blocked
     * once any warehouse issue was posted: at that point a correction document is required.
     */
    async returnApprovedOrderToReview(tx: Prisma.TransactionClient, orderId: string, actor: SalesActor) {
        const order = await tx.salesOrder.findUnique({
            where: { id: orderId },
            select: { id: true, orderNo: true, kind: true, status: true, approvalCycle: true, version: true },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        this.assertInternalKind(order.kind)
        const reopenable: SalesOrderStatus[] = [
            SalesOrderStatus.CONFIRMED,
            SalesOrderStatus.AWAITING_STOCK,
            SalesOrderStatus.PARTIALLY_RESERVED,
            SalesOrderStatus.RESERVED,
            SalesOrderStatus.WAREHOUSE_PROCESSING,
        ]
        if (!reopenable.includes(order.status)) {
            throw new BadRequestException({
                code: 'SALES_ORDER_NOT_REOPENABLE',
                message: `Đơn ${order.orderNo} không thể trả về chờ duyệt ở trạng thái ${order.status}.`,
            })
        }
        if (await this.deliveries.hasPostedDelivery(tx, orderId)) {
            throw new BadRequestException({
                code: 'SALES_ORDER_HAS_POSTED_DELIVERY',
                message: 'Đơn đã có phiếu xuất kho thành công — phải xử lý bằng chứng từ điều chỉnh.',
            })
        }
        if (order.kind === SalesOrderKind.LOT) {
            const withdrawalCount = await tx.salesLotWithdrawalRequest.count({ where: { salesOrderId: orderId } })
            const changedPositionCount = await tx.salesLotPosition.count({
                where: {
                    orderLine: { salesOrderId: orderId },
                    OR: [{ issuedQty: { gt: 0 } }, { adjustedQty: { gt: 0 } }, { adjustments: { some: {} } }],
                },
            })
            if (withdrawalCount || changedPositionCount) {
                throw new BadRequestException({
                    code: 'SALES_LOT_HAS_WITHDRAWAL_HISTORY',
                    message: 'Đơn lô đã phát sinh rút hàng hoặc điều chỉnh — không thể trả về chờ duyệt.',
                })
            }
            await tx.salesLotPosition.deleteMany({ where: { orderLine: { salesOrderId: orderId } } })
        }

        const reason = `Trả đơn ${order.orderNo} về chờ duyệt`
        await this.deliveries.voidOpenDeliveries(tx, orderId, actor, reason)
        await this.reservations.releaseOrder(tx, orderId, actor, reason)
        await tx.salesApprovalRequest.updateMany({
            where: {
                salesOrderId: orderId,
                approvalCycle: order.approvalCycle,
                status: SalesApprovalStatus.APPROVED,
            },
            data: { status: SalesApprovalStatus.PENDING, decidedById: null, decidedAt: null, decisionNote: null },
        })
        await tx.salesOrder.update({
            where: { id: orderId },
            data: {
                status: SalesOrderStatus.PENDING_REVIEW,
                approvedAt: null,
                approvedById: null,
                version: { increment: 1 },
            },
        })
        await this.events.record(tx, {
            entityType: 'SALES_ORDER',
            entityId: orderId,
            eventType: 'RETURN_TO_REVIEW',
            fromStatus: order.status,
            toStatus: SalesOrderStatus.PENDING_REVIEW,
            actorId: actor.userId,
            reason,
            cycle: order.approvalCycle,
            version: order.version + 1,
        })
    }

    /** Manual retry for an order parked at AWAITING_STOCK/PARTIALLY_RESERVED. */
    async retryReserve(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                select: { id: true, kind: true, status: true },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            const retryable: SalesOrderStatus[] = [
                SalesOrderStatus.CONFIRMED,
                SalesOrderStatus.AWAITING_STOCK,
                SalesOrderStatus.PARTIALLY_RESERVED,
            ]
            if (!retryable.includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_RESERVABLE',
                    message: `Không thể giữ hàng cho đơn ở trạng thái ${order.status}.`,
                })
            }
            await this.reserveAndDispatch(tx, id, actor)
        })
        return this.orders.detail(id)
    }

    async recall(id: string, actor: SalesActor) {
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { name: true } },
                    approvalRequests: { where: { status: { not: SalesApprovalStatus.STALE } } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (order.status !== SalesOrderStatus.PENDING_REVIEW) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_RECALLABLE',
                    message: 'Chỉ thu hồi được đơn đang chờ kiểm duyệt.',
                })
            }
            const currentCycle = order.approvalRequests.filter(
                (request) => request.approvalCycle === order.approvalCycle,
            )
            if (currentCycle.some((request) => request.status !== SalesApprovalStatus.PENDING)) {
                // Spec §5 (workflow gốc): chỉ thu hồi khi CHƯA có người xử lý.
                throw new BadRequestException({
                    code: 'SALES_ORDER_ALREADY_PROCESSED',
                    message: 'Đã có bộ phận xử lý yêu cầu duyệt — không thể thu hồi, hãy chờ kết quả.',
                })
            }
            await tx.salesApprovalRequest.updateMany({
                where: {
                    salesOrderId: id,
                    approvalCycle: order.approvalCycle,
                    status: SalesApprovalStatus.PENDING,
                },
                data: { status: SalesApprovalStatus.CANCELLED },
            })
            await tx.salesOrder.update({
                where: { id },
                data: { status: SalesOrderStatus.DRAFT, version: { increment: 1 } },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'RECALL',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.DRAFT,
                actorId: actor.userId,
                cycle: order.approvalCycle,
            })
            const involvedPermissionCodes = [
                ...new Set(currentCycle.map((request) => APPROVAL_TYPE_PERMISSIONS[request.type])),
            ]
            if (involvedPermissionCodes.length) {
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.ORDER_RECALLED,
                        aggregateType: 'SALES_ORDER',
                        aggregateId: id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_RECALLED}:${id}:cycle${order.approvalCycle}`,
                        payload: {
                            entityType: 'SALES_ORDER',
                            entityId: id,
                            orderNo: order.orderNo,
                            customerName: order.customer.name,
                            cycle: order.approvalCycle,
                            recipientPermissionCodes: involvedPermissionCodes,
                            excludeUserIds: actor.userId ? [actor.userId] : [],
                        },
                    },
                    tx,
                )
            }
        })
        return this.orders.detail(id)
    }

    async cancel(id: string, reason: string | undefined, actor: SalesActor) {
        if (!reason?.trim()) {
            throw new BadRequestException({
                code: 'CANCEL_REASON_REQUIRED',
                message: 'Hủy đơn bắt buộc phải nhập lý do.',
            })
        }
        const cancellableStatuses: SalesOrderStatus[] = [
            SalesOrderStatus.DRAFT,
            SalesOrderStatus.PENDING_REVIEW,
            SalesOrderStatus.REJECTED,
            SalesOrderStatus.CONFIRMED,
            SalesOrderStatus.AWAITING_STOCK,
            SalesOrderStatus.PARTIALLY_RESERVED,
            SalesOrderStatus.RESERVED,
            // Allowed only while no delivery has posted — checked below (spec v1.2 §4.1).
            SalesOrderStatus.WAREHOUSE_PROCESSING,
        ]
        await this.prisma.$transaction(async (tx) => {
            const order = await tx.salesOrder.findUnique({
                where: { id },
                include: {
                    customer: { select: { name: true } },
                    approvalRequests: { where: { status: SalesApprovalStatus.PENDING } },
                },
            })
            if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
            this.assertInternalKind(order.kind)
            if (!cancellableStatuses.includes(order.status)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_CANCELLABLE',
                    message: `Không thể hủy đơn ở trạng thái ${order.status}.`,
                })
            }
            if (await this.deliveries.hasPostedDelivery(tx, id)) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_HAS_POSTED_DELIVERY',
                    message: 'Đơn đã có lệnh xuất kho thành công — phải xử lý bằng chứng từ điều chỉnh.',
                })
            }
            const liveInvoices = await tx.salesInvoice.findMany({
                where: {
                    status: { not: 'CANCELLED' },
                    OR: [
                        { salesOrderId: id },
                        { withdrawalRequest: { salesOrderId: id } },
                    ],
                },
                select: { id: true, invoiceNoInternal: true, status: true },
            })
            const nonDraftInvoice = liveInvoices.find((invoice) => invoice.status !== 'DRAFT')
            if (nonDraftInvoice) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_HAS_EFFECTIVE_INVOICE',
                    message: `Đơn đã có hóa đơn ${nonDraftInvoice.invoiceNoInternal} ở trạng thái ${nonDraftInvoice.status}. Phải xử lý hóa đơn trước khi hủy đơn.`,
                    detail: nonDraftInvoice,
                })
            }
            const cancelReason = reason.trim()
            if (liveInvoices.length) {
                await tx.salesInvoice.updateMany({
                    where: { id: { in: liveInvoices.map((invoice) => invoice.id) }, status: 'DRAFT' },
                    data: {
                        status: 'CANCELLED',
                        cancelledAt: new Date(),
                        cancelledById: actor.userId,
                        cancelReason,
                        version: { increment: 1 },
                    },
                })
            }
            await this.deliveries.voidOpenDeliveries(tx, id, actor, cancelReason)
            await this.reservations.releaseOrder(tx, id, actor, cancelReason)
            await tx.salesApprovalRequest.updateMany({
                where: { salesOrderId: id, status: SalesApprovalStatus.PENDING },
                data: { status: SalesApprovalStatus.CANCELLED },
            })
            await tx.salesOrder.update({
                where: { id },
                data: {
                    status: SalesOrderStatus.CANCELLED,
                    cancelledAt: new Date(),
                    cancelledById: actor.userId,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: id,
                eventType: 'CANCEL',
                fromStatus: order.status,
                toStatus: SalesOrderStatus.CANCELLED,
                actorId: actor.userId,
                reason: reason ?? null,
                cycle: order.approvalCycle,
            })

            const involvedPermissionCodes = [
                ...new Set(order.approvalRequests.map((request) => APPROVAL_TYPE_PERMISSIONS[request.type])),
            ]
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.ORDER_CANCELLED,
                    aggregateType: 'SALES_ORDER',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_CANCELLED}:${id}:v${order.version + 1}`,
                    payload: {
                        entityType: 'SALES_ORDER',
                        entityId: id,
                        orderNo: order.orderNo,
                        customerName: order.customer.name,
                        reasonSummary: reason ?? '',
                        cycle: order.approvalCycle,
                        recipientUserIds: order.createdById ? [order.createdById] : [],
                        recipientPermissionCodes: involvedPermissionCodes,
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
        })
        return this.orders.detail(id)
    }

    /** Read-only preview of the internal checks for the Sale before submitting. */
    async previewChecks(id: string) {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id },
            select: { id: true, kind: true },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')
        this.assertInternalKind(order.kind)
        return this.checks.run(this.prisma, id)
    }
}
