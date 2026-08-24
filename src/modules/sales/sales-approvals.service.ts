import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import {
    Prisma,
    SalesApprovalStatus,
    SalesApprovalType,
    SalesOrderKind,
    SalesOrderStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import {
    APPROVAL_TYPE_LABELS,
    APPROVAL_TYPE_PERMISSIONS,
    SalesActor,
    SalesOrderWorkflowService,
} from './sales-order-workflow.service'
import { ListSalesApprovalsQueryDto } from './dto/sales-order.dto'
import { SalesReservationService } from './sales-reservation.service'

/**
 * Khoảng ngày cho cột @db.Date: giá trị lưu là 00:00 UTC nên cả hai đầu đều lấy
 * đúng mốc nửa đêm của ngày người dùng chọn — dùng lte thì ngày cuối vẫn nằm trong.
 */
function buildDateRange(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    const parse = (value?: string) => {
        if (!value) return undefined
        const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
        return Number.isNaN(date.getTime()) ? undefined : date
    }
    const gte = parse(from)
    const lte = parse(to)
    if (!gte && !lte) return undefined
    return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) }
}

/** Parallel per-department approval handling (spec v1.2 §3.5, §7). */
@Injectable()
export class SalesApprovalsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly workflow: SalesOrderWorkflowService,
        private readonly events: SalesWorkflowEventsService,
        private readonly notificationOutbox: NotificationOutboxService,
        private readonly reservations: SalesReservationService,
    ) {}

    async list(query: ListSalesApprovalsQueryDto, actor: SalesActor) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        // Hàng đợi duyệt mặc định chỉ hiện việc còn phải làm; nhưng khi hỏi theo một
        // chứng từ cụ thể thì màn hình chi tiết cần cả lịch sử, kể cả vòng duyệt cũ.
        const askingForOneEntity = Boolean(query.salesOrderId || query.withdrawalRequestId)
        const status =
            (query.status as SalesApprovalStatus) ??
            (askingForOneEntity ? undefined : SalesApprovalStatus.PENDING)

        const permissions = new Set(actor.permissions ?? [])
        const isAdmin = permissions.has('system.rbac.admin')
        const decidableTypes = (Object.keys(APPROVAL_TYPE_PERMISSIONS) as SalesApprovalType[]).filter(
            (type) => isAdmin || permissions.has(APPROVAL_TYPE_PERMISSIONS[type]),
        )

        // Bộ lọc chứng từ phải bắt cả hai nhánh: yêu cầu gắn đơn bán, và yêu cầu gắn
        // phiếu rút lô. Mỗi điều kiện là một OR riêng nên chúng cộng dồn (AND) với nhau.
        const documentFilters: Prisma.SalesApprovalRequestWhereInput[] = []
        if (query.customerPartyId) {
            documentFilters.push({
                OR: [
                    { salesOrder: { customerPartyId: query.customerPartyId } },
                    { withdrawalRequest: { customerPartyId: query.customerPartyId } },
                ],
            })
        }
        if (query.kind) {
            // Loại đơn chỉ có ở đơn bán; phiếu rút luôn thuộc đơn LOT.
            documentFilters.push({ salesOrder: { kind: query.kind as SalesOrderKind } })
        }
        const dateRange = buildDateRange(query.dateFrom, query.dateTo)
        if (dateRange) {
            documentFilters.push({
                OR: [
                    { salesOrder: { orderDate: dateRange } },
                    { withdrawalRequest: { requestDate: dateRange } },
                ],
            })
        }
        const keyword = query.keyword?.trim()
        if (keyword) {
            const contains = { contains: keyword, mode: Prisma.QueryMode.insensitive } as const
            documentFilters.push({
                OR: [
                    { salesOrder: { orderNo: contains } },
                    { salesOrder: { customer: { name: contains } } },
                    { salesOrder: { customer: { code: contains } } },
                    { withdrawalRequest: { requestNo: contains } },
                    { withdrawalRequest: { customer: { name: contains } } },
                    { withdrawalRequest: { customer: { code: contains } } },
                ],
            })
        }

        const where: Prisma.SalesApprovalRequestWhereInput = {
            status,
            salesOrderId: query.salesOrderId ?? undefined,
            withdrawalRequestId: query.withdrawalRequestId ?? undefined,
            type: query.type
                ? (query.type as SalesApprovalType)
                : query.mine
                  ? { in: decidableTypes }
                  : undefined,
            ...(documentFilters.length ? { AND: documentFilters } : {}),
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesApprovalRequest.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    salesOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            kind: true,
                            status: true,
                            orderDate: true,
                            approvalCycle: true,
                            customer: { select: { id: true, code: true, name: true } },
                            lines: {
                                orderBy: { lineNo: 'asc' },
                                select: {
                                    id: true,
                                    lineNo: true,
                                    productId: true,
                                    issueWarehouseId: true,
                                    supplySource: true,
                                    preferredSupplierPartyId: true,
                                    orderedActualQty: true,
                                    unitPrice: true,
                                    discountBaseAmount: true,
                                    discountAdjustmentAmount: true,
                                    discountAmount: true,
                                    taxRate: true,
                                    product: { select: { code: true, name: true, uom: true } },
                                    issueWarehouse: {
                                        select: {
                                            id: true,
                                            name: true,
                                            legalEntity: { select: { partyId: true } },
                                        },
                                    },
                                    preferredSupplier: { select: { id: true, code: true, name: true } },
                                },
                            },
                            reservations: {
                                where: { status: { in: ['DRAFT', 'ACTIVE', 'PARTIALLY_RELEASED'] } },
                                select: {
                                    lines: {
                                        where: { activeActualQty: { gt: 0 }, inventoryLotId: { not: null } },
                                        select: {
                                            salesOrderLineId: true,
                                            inventoryLotId: true,
                                            activeActualQty: true,
                                            lot: {
                                                select: {
                                                    lotNo: true,
                                                    releaseCode: true,
                                                    supplier: { select: { id: true, code: true, name: true } },
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                    // Yêu cầu duyệt của phiếu rút lô không có salesOrder — hàng đợi
                    // vẫn phải hiện được số phiếu và khách để người duyệt biết đang duyệt gì.
                    withdrawalRequest: {
                        select: {
                            id: true,
                            requestNo: true,
                            requestDate: true,
                            status: true,
                            vehiclePlate: true,
                            driverName: true,
                            salesOrder: { select: { id: true, orderNo: true } },
                            customer: { select: { id: true, code: true, name: true } },
                        },
                    },
                },
            }),
            this.prisma.salesApprovalRequest.count({ where }),
        ])

        const previewLines = new Map<
            string,
            {
                productId: string
                supplySource: 'TP' | 'NCC'
                orderedActualQty: Prisma.Decimal
                issueWarehouse: { id: string; legalEntity: { partyId: string } }
            }
        >()
        for (const row of rows) {
            if (row.salesOrder?.kind !== SalesOrderKind.SINGLE) continue
            for (const line of row.salesOrder.lines) {
                if (!line.issueWarehouse) continue
                previewLines.set(line.id, {
                    productId: line.productId,
                    supplySource: line.supplySource,
                    orderedActualQty: line.orderedActualQty,
                    issueWarehouse: line.issueWarehouse,
                })
            }
        }
        const supplierPreviewByLine = new Map<string, Awaited<ReturnType<SalesReservationService['previewSupplierChoices']>>>()
        if (previewLines.size) {
            await this.prisma.$transaction(async (tx) => {
                for (const [lineId, line] of previewLines) {
                    supplierPreviewByLine.set(
                        lineId,
                        await this.reservations.previewSupplierChoices(
                            tx,
                            {
                                warehouseId: line.issueWarehouse.id,
                                productId: line.productId,
                                ownerPartyId: line.issueWarehouse.legalEntity.partyId,
                                supplySource: line.supplySource,
                            },
                            line.orderedActualQty,
                        ),
                    )
                }
            })
        }
        return {
            items: rows.map((row) => ({
                ...row,
                typeLabel: APPROVAL_TYPE_LABELS[row.type],
                canDecide: decidableTypes.includes(row.type),
                salesOrder: row.salesOrder
                    ? {
                          ...row.salesOrder,
                          // CK gốc và CK điều chỉnh đã được chốt trên dòng đơn lúc tạo —
                          // đọc thẳng, không tra lại bảng công bố (bảng có thể đã đổi).
                           lines: row.salesOrder.lines.map((line) => ({
                               ...line,
                               supplierAllocations: row.salesOrder!.reservations
                                   .flatMap((reservation) => reservation.lines)
                                   .filter((allocation) => allocation.salesOrderLineId === line.id)
                                   .map((allocation) => ({
                                       inventoryLotId: allocation.inventoryLotId,
                                       lotNo: allocation.lot?.lotNo ?? null,
                                       supplier: allocation.lot?.supplier ?? null,
                                       releaseCode: allocation.lot?.releaseCode ?? null,
                                       actualQty: allocation.activeActualQty.toString(),
                                    })),
                                supplierPreview: supplierPreviewByLine.get(line.id) ?? null,
                                lineNetAmount: new Prisma.Decimal(line.orderedActualQty)
                                  .mul(new Prisma.Decimal(line.unitPrice).minus(line.discountAmount))
                                  .toString(),
                          })),
                          orderNetAmount: row.salesOrder.lines
                              .reduce(
                                  (sum, line) =>
                                      sum.plus(
                                          new Prisma.Decimal(line.orderedActualQty).mul(
                                              new Prisma.Decimal(line.unitPrice).minus(
                                                  line.discountAmount,
                                              ),
                                          ),
                                      ),
                                  new Prisma.Decimal(0),
                              )
                              .toString(),
                      }
                    : row.salesOrder,
            })),
            total,
            page,
            limit,
        }
    }

    /**
     * Người duyệt sửa CK điều chỉnh ngay trên hàng đợi. CK cuối luôn = CK gốc + điều
     * chỉnh, nên thành tiền của đơn tính lại theo con số mới.
     *
     * CK gốc giữ nguyên: đó là mức đã công bố, không phải thứ người duyệt được viết đè.
     * Chỉ sửa được khi đơn còn đang chờ duyệt — đơn đã chốt thì phải thu hồi mới sửa.
     */
    async adjustLineDiscount(
        lineId: string,
        discountAdjustmentAmount: number,
        actor: SalesActor,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const line = await tx.salesOrderLine.findUnique({
                where: { id: lineId },
                select: {
                    id: true,
                    discountBaseAmount: true,
                    unitPrice: true,
                    salesOrder: { select: { id: true, orderNo: true, status: true } },
                },
            })
            if (!line) throw new NotFoundException('SALES_ORDER_LINE_NOT_FOUND')
            if (line.salesOrder.status !== SalesOrderStatus.PENDING_REVIEW) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_PENDING_REVIEW',
                    message: `Đơn ${line.salesOrder.orderNo} không còn ở trạng thái chờ duyệt nên không sửa được chiết khấu.`,
                })
            }

            const adjustment = new Prisma.Decimal(discountAdjustmentAmount)
            const finalDiscount = new Prisma.Decimal(line.discountBaseAmount).plus(adjustment)
            if (finalDiscount.isNegative()) {
                throw new BadRequestException({
                    code: 'DISCOUNT_NEGATIVE',
                    message: 'Chiết khấu cuối không được âm — điều chỉnh giảm quá mức chiết khấu gốc.',
                })
            }
            if (finalDiscount.greaterThan(line.unitPrice)) {
                throw new BadRequestException({
                    code: 'DISCOUNT_EXCEEDS_PRICE',
                    message: 'Chiết khấu cuối vượt quá đơn giá — thành tiền sẽ âm.',
                })
            }

            await tx.salesOrderLine.update({
                where: { id: lineId },
                data: {
                    discountAdjustmentAmount: adjustment,
                    discountAmount: finalDiscount,
                },
            })

            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: line.salesOrder.id,
                eventType: 'ADJUST_DISCOUNT',
                actorId: actor.userId,
                metadata: {
                    salesOrderLineId: lineId,
                    discountAdjustmentAmount: adjustment.toString(),
                    discountAmount: finalDiscount.toString(),
                },
            })

            const lines = await tx.salesOrderLine.findMany({
                where: { salesOrderId: line.salesOrder.id },
                select: { orderedActualQty: true, unitPrice: true, discountAmount: true },
            })
            const orderNetAmount = lines.reduce(
                (sum, row) =>
                    sum.plus(
                        new Prisma.Decimal(row.orderedActualQty).mul(
                            new Prisma.Decimal(row.unitPrice).minus(row.discountAmount),
                        ),
                    ),
                new Prisma.Decimal(0),
            )

            return {
                salesOrderLineId: lineId,
                salesOrderId: line.salesOrder.id,
                discountBaseAmount: line.discountBaseAmount.toString(),
                discountAdjustmentAmount: adjustment.toString(),
                discountAmount: finalDiscount.toString(),
                orderNetAmount: orderNetAmount.toString(),
            }
        })
    }

    /** Chọn một mã NCC cụ thể hoặc trả về AUTO FIFO khi đơn còn ở hàng đợi duyệt. */
    async adjustLineSupplier(lineId: string, supplierPartyId: string | null | undefined, actor: SalesActor) {
        return this.prisma.$transaction(async (tx) => {
            const line = await tx.salesOrderLine.findUnique({
                where: { id: lineId },
                include: {
                    salesOrder: { select: { id: true, orderNo: true, kind: true, status: true } },
                    issueWarehouse: {
                        select: { id: true, legalEntity: { select: { partyId: true } } },
                    },
                },
            })
            if (!line) throw new NotFoundException('SALES_ORDER_LINE_NOT_FOUND')
            if (
                line.salesOrder.kind !== SalesOrderKind.SINGLE ||
                line.salesOrder.status !== SalesOrderStatus.PENDING_REVIEW
            ) {
                throw new BadRequestException({
                    code: 'SALES_ORDER_NOT_PENDING_REVIEW',
                    message: `Đơn ${line.salesOrder.orderNo} không còn ở trạng thái chờ duyệt nên không đổi được Mã NCC.`,
                })
            }
            if (!line.issueWarehouse) {
                throw new BadRequestException({ code: 'RECEIVING_WAREHOUSE_REQUIRED', message: 'Dòng đơn chưa có Kho nhận.' })
            }

            const selectedSupplierId = supplierPartyId || null
            if (selectedSupplierId) {
                const preview = await this.reservations.previewSupplierChoices(
                    tx,
                    {
                        warehouseId: line.issueWarehouse.id,
                        productId: line.productId,
                        ownerPartyId: line.issueWarehouse.legalEntity.partyId,
                        supplySource: line.supplySource,
                    },
                    line.orderedActualQty,
                )
                const option = preview.supplierOptions.find((row) => row.supplierPartyId === selectedSupplierId)
                if (!option) {
                    throw new BadRequestException({
                        code: 'SUPPLIER_STOCK_NOT_AVAILABLE',
                        message: 'Mã NCC đã chọn không có tồn phù hợp tại Kho nhận của dòng đơn.',
                    })
                }
                if (new Prisma.Decimal(option.availableQty).lessThan(line.orderedActualQty)) {
                    throw new BadRequestException({
                        code: 'SUPPLIER_STOCK_INSUFFICIENT',
                        message: `Mã NCC ${option.supplierCode} chỉ còn ${option.availableQty}, không đủ ${line.orderedActualQty}.`,
                    })
                }
            }

            const updated = await tx.salesOrderLine.update({
                where: { id: line.id },
                data: { preferredSupplierPartyId: selectedSupplierId },
                select: {
                    id: true,
                    preferredSupplierPartyId: true,
                    preferredSupplier: { select: { id: true, code: true, name: true } },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_ORDER',
                entityId: line.salesOrder.id,
                eventType: 'SELECT_FIFO_SUPPLIER',
                actorId: actor.userId,
                metadata: { salesOrderLineId: line.id, supplierPartyId: selectedSupplierId, mode: selectedSupplierId ? 'MANUAL' : 'FIFO' },
            })
            return updated
        })
    }

    private assertActorCanDecide(type: SalesApprovalType, actor: SalesActor) {
        const permissions = new Set(actor.permissions ?? [])
        if (permissions.has('system.rbac.admin')) return
        if (!permissions.has(APPROVAL_TYPE_PERMISSIONS[type])) {
            throw new ForbiddenException({
                code: 'SALES_APPROVAL_PERMISSION_MISSING',
                message: `Bạn không có quyền duyệt ${APPROVAL_TYPE_LABELS[type]}.`,
            })
        }
    }

    /** Reopen an approved order in the same approval cycle for a new decision. */
    async returnToPending(requestId: string, actor: SalesActor) {
        const salesOrderId = await this.prisma.$transaction(async (tx) => {
            const request = await tx.salesApprovalRequest.findUnique({
                where: { id: requestId },
                select: { id: true, type: true, status: true, salesOrderId: true },
            })
            if (!request) throw new NotFoundException('SALES_APPROVAL_NOT_FOUND')
            if (!request.salesOrderId) {
                throw new BadRequestException({
                    code: 'SALES_APPROVAL_REOPEN_ORDER_ONLY',
                    message: 'Chỉ có thể trả đơn bán về chờ duyệt tại màn này.',
                })
            }
            if (request.status !== SalesApprovalStatus.APPROVED) {
                throw new BadRequestException({
                    code: 'SALES_APPROVAL_NOT_APPROVED',
                    message: 'Chỉ yêu cầu đã duyệt mới có thể trả về chờ duyệt.',
                })
            }
            this.assertActorCanDecide(request.type, actor)
            await this.workflow.returnApprovedOrderToReview(tx, request.salesOrderId, actor)
            return request.salesOrderId
        })
        return { salesOrderId, status: SalesOrderStatus.PENDING_REVIEW }
    }

    async decide(
        requestId: string,
        decision: 'APPROVED' | 'REJECTED',
        note: string | undefined,
        actor: SalesActor,
    ) {
        if (decision === 'REJECTED' && !note?.trim()) {
            throw new BadRequestException({
                code: 'DECISION_NOTE_REQUIRED',
                message: 'Từ chối bắt buộc phải nhập lý do.',
            })
        }

        const salesOrderId = await this.prisma.$transaction(async (tx) => {
            const request = await tx.salesApprovalRequest.findUnique({
                where: { id: requestId },
                include: {
                    salesOrder: {
                        include: { customer: { select: { name: true } } },
                    },
                },
            })
            if (!request) throw new NotFoundException('SALES_APPROVAL_NOT_FOUND')
            this.assertActorCanDecide(request.type, actor)

            const order = request.salesOrder
            if (!order) {
                // Withdrawal-targeted approvals belong to the lot draw flow (GĐ 5).
                throw new BadRequestException({
                    code: 'SALES_APPROVAL_NOT_ORDER_TARGET',
                    message: 'Yêu cầu duyệt này thuộc yêu cầu rút lô, không xử lý ở luồng đơn bán.',
                })
            }
            if (
                request.status !== SalesApprovalStatus.PENDING ||
                order.status !== SalesOrderStatus.PENDING_REVIEW ||
                request.approvalCycle !== order.approvalCycle
            ) {
                throw new BadRequestException({
                    code: 'SALES_APPROVAL_NOT_PENDING',
                    message: 'Yêu cầu duyệt không còn hiệu lực (đã xử lý hoặc đơn đã thay đổi).',
                })
            }
            // Maker-checker (D5): system admin has full authority and may decide
            // their own order; every other user remains subject to maker-checker.
            const isSystemAdmin = new Set(actor.permissions ?? []).has('system.rbac.admin')
            if (
                process.env.SALES_MAKER_CHECKER !== '0' &&
                !isSystemAdmin &&
                actor.userId &&
                (actor.userId === order.createdById || actor.userId === order.submittedById)
            ) {
                throw new ForbiddenException({
                    code: 'SALES_APPROVAL_MAKER_CHECKER',
                    message: 'Người tạo/gửi đơn không được tự duyệt đơn của mình.',
                })
            }

            const now = new Date()
            await tx.salesApprovalRequest.update({
                where: { id: requestId },
                data: {
                    status:
                        decision === 'APPROVED'
                            ? SalesApprovalStatus.APPROVED
                            : SalesApprovalStatus.REJECTED,
                    decidedById: actor.userId,
                    decidedAt: now,
                    decisionNote: note?.trim() || null,
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_APPROVAL',
                entityId: requestId,
                eventType: decision,
                fromStatus: SalesApprovalStatus.PENDING,
                toStatus: decision,
                actorId: actor.userId,
                reason: note?.trim() || null,
                cycle: request.approvalCycle,
                metadata: { salesOrderId: order.id, type: request.type },
            })

            if (decision === 'REJECTED') {
                // One rejection rejects the order; sibling pending requests become moot.
                await tx.salesApprovalRequest.updateMany({
                    where: {
                        salesOrderId: order.id,
                        approvalCycle: order.approvalCycle,
                        status: SalesApprovalStatus.PENDING,
                    },
                    data: { status: SalesApprovalStatus.CANCELLED },
                })
                await tx.salesOrder.update({
                    where: { id: order.id },
                    data: {
                        status: SalesOrderStatus.REJECTED,
                        rejectedReason: note!.trim(),
                        version: { increment: 1 },
                    },
                })
                await this.events.record(tx, {
                    entityType: 'SALES_ORDER',
                    entityId: order.id,
                    eventType: 'REJECT',
                    fromStatus: SalesOrderStatus.PENDING_REVIEW,
                    toStatus: SalesOrderStatus.REJECTED,
                    actorId: actor.userId,
                    reason: note!.trim(),
                    cycle: order.approvalCycle,
                })
                const decider = actor.userId
                    ? await tx.user.findUnique({
                          where: { id: actor.userId },
                          select: { name: true, username: true },
                      })
                    : null
                await this.notificationOutbox.emit(
                    {
                        eventType: SALES_NOTIFICATION_EVENTS.ORDER_REJECTED,
                        aggregateType: 'SALES_ORDER',
                        aggregateId: order.id,
                        dedupeKey: `${SALES_NOTIFICATION_EVENTS.ORDER_REJECTED}:${order.id}:cycle${order.approvalCycle}`,
                        payload: {
                            entityType: 'SALES_ORDER',
                            entityId: order.id,
                            workItemSourceType: 'SALES_ORDER',
                            workItemSourceId: order.id,
                            actionRequired: true,
                            orderNo: order.orderNo,
                            customerName: order.customer.name,
                            approvalType: request.type,
                            approvalTypeLabel: APPROVAL_TYPE_LABELS[request.type],
                            deciderName: decider?.name ?? decider?.username ?? 'Người duyệt',
                            decisionNote: note!.trim(),
                            cycle: order.approvalCycle,
                            recipientUserIds: [order.createdById, order.submittedById].filter(
                                (value): value is string => !!value,
                            ),
                            excludeUserIds: actor.userId ? [actor.userId] : [],
                        },
                    },
                    tx,
                )
                return order.id
            }

            const stillPending = await tx.salesApprovalRequest.count({
                where: {
                    salesOrderId: order.id,
                    approvalCycle: order.approvalCycle,
                    status: SalesApprovalStatus.PENDING,
                },
            })
            if (stillPending === 0) {
                await tx.salesOrder.update({
                    where: { id: order.id },
                    data: {
                        status: SalesOrderStatus.CONFIRMED,
                        approvedAt: now,
                        approvedById: actor.userId,
                        version: { increment: 1 },
                    },
                })
                await this.events.record(tx, {
                    entityType: 'SALES_ORDER',
                    entityId: order.id,
                    eventType: 'APPROVE',
                    fromStatus: SalesOrderStatus.PENDING_REVIEW,
                    toStatus: SalesOrderStatus.CONFIRMED,
                    actorId: actor.userId,
                    cycle: order.approvalCycle,
                })
                await this.workflow.emitOrderApproved(tx, {
                    orderId: order.id,
                    orderNo: order.orderNo,
                    customerName: order.customer.name,
                    recipientUserIds: [order.createdById, order.submittedById].filter(
                        (value): value is string => !!value,
                    ),
                    cycle: order.approvalCycle,
                })
                // Approval itself changes no stock; it opens lot balances or triggers the
                // hold and the per-warehouse issue jobs (spec v1.2 §4.1, §4.2).
                await this.workflow.onApproved(tx, order.id, actor)
            }
            return order.id
        })

        return this.prisma.salesApprovalRequest.findUnique({
            where: { id: requestId },
            include: {
                salesOrder: {
                    select: { id: true, orderNo: true, status: true, approvalCycle: true },
                },
            },
        }).then((row) => ({ ...row, salesOrderId }))
    }

    /**
     * Duyệt/từ chối nhiều yêu cầu một lượt.
     *
     * Chạy tuần tự và bắt lỗi từng cái thay vì gói vào một transaction: mỗi yêu cầu là
     * một quyết định độc lập, một cái hỏng (đơn đã đổi, hết quyền) không có lý do gì làm
     * hỏng những cái còn lại. Kết quả trả về nói rõ cái nào không xong và vì sao.
     */
    async decideMany(
        requestIds: string[],
        decision: 'APPROVED' | 'REJECTED',
        note: string | undefined,
        actor: SalesActor,
    ) {
        const succeeded: string[] = []
        const failed: Array<{ id: string; orderNo: string | null; message: string }> = []

        for (const id of requestIds) {
            try {
                await this.decide(id, decision, note, actor)
                succeeded.push(id)
            } catch (error) {
                const request = await this.prisma.salesApprovalRequest.findUnique({
                    where: { id },
                    select: { salesOrder: { select: { orderNo: true } } },
                })
                const raw = (error as { response?: { message?: string }; message?: string })
                failed.push({
                    id,
                    orderNo: request?.salesOrder?.orderNo ?? null,
                    message: raw?.response?.message ?? raw?.message ?? 'Không xử lý được',
                })
            }
        }
        return { succeeded: succeeded.length, failed }
    }
}
