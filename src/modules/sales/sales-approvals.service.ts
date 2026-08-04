import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SalesApprovalStatus, SalesApprovalType, SalesOrderStatus } from '@prisma/client'
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

/** Parallel per-department approval handling (spec v1.2 §3.5, §7). */
@Injectable()
export class SalesApprovalsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly workflow: SalesOrderWorkflowService,
        private readonly events: SalesWorkflowEventsService,
        private readonly notificationOutbox: NotificationOutboxService,
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

        const where: Prisma.SalesApprovalRequestWhereInput = {
            status,
            salesOrderId: query.salesOrderId ?? undefined,
            withdrawalRequestId: query.withdrawalRequestId ?? undefined,
            type: query.type
                ? (query.type as SalesApprovalType)
                : query.mine
                  ? { in: decidableTypes }
                  : undefined,
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
        return {
            items: rows.map((row) => ({
                ...row,
                typeLabel: APPROVAL_TYPE_LABELS[row.type],
                canDecide: decidableTypes.includes(row.type),
            })),
            total,
            page,
            limit,
        }
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
            // Maker-checker (D5): the sale who created/submitted the order cannot decide it.
            if (
                process.env.SALES_MAKER_CHECKER !== '0' &&
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
}
