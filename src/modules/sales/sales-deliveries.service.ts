import {
    BadRequestException,
    ConflictException,
    HttpException,
    Injectable,
    NotFoundException,
} from '@nestjs/common'
import {
    Prisma,
    ReservationStatus,
    SalesDeliveryStatus,
    SalesInvoiceStatus,
    SalesOrderKind,
    SalesOrderStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesIssuePostingService } from 'src/modules/inventory/sales-issue-posting.service'
import { SalesWorkflowEventsService } from './sales-workflow-events.service'
import { SalesOrderStatusService } from './sales-order-status.service'
import { SalesReservationService } from './sales-reservation.service'
import { SalesReconciliationService } from './sales-reconciliation.service'
import { SalesLotService } from './sales-lot.service'
import { SalesWithdrawalsService } from './sales-withdrawals.service'
import { SalesWarehouseScopeService, ScopedActor } from './sales-warehouse-scope.service'
import {
    ConfirmSalesDeliveryDto,
    ListSalesDeliveriesQueryDto,
    QuickConfirmSalesDeliveriesDto,
    ReturnSalesDeliveryDto,
    VoidSalesDeliveryDto,
} from './dto/sales-delivery.dto'

const deliveryDetailInclude = Prisma.validator<Prisma.SalesDeliveryInclude>()({
    warehouse: { select: { id: true, code: true, name: true } },
    salesOrder: {
        select: {
            id: true,
            orderNo: true,
            kind: true,
            status: true,
            orderDate: true,
            createdById: true,
            customer: { select: { id: true, code: true, name: true } },
        },
    },
    lines: {
        orderBy: { lineNo: 'asc' },
        include: {
            orderLine: {
                select: {
                    id: true,
                    lineNo: true,
                     productId: true,
                     supplySource: true,
                    orderedActualQty: true,
                    note: true,
                    product: { select: { id: true, code: true, name: true, uom: true } },
                },
            },
        },
    },
})

/**
 * A SalesDelivery is one warehouse's share of the work for an order (spec v1.2 D1).
 * GĐ 2 covers creating the jobs, the warehouse queue and the return-to-sales path;
 * confirming the issue (posting stock and cost) lands in GĐ 3.
 */
@Injectable()
export class SalesDeliveriesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly events: SalesWorkflowEventsService,
        private readonly status: SalesOrderStatusService,
        private readonly scope: SalesWarehouseScopeService,
        private readonly issuePosting: SalesIssuePostingService,
        private readonly reservations: SalesReservationService,
        private readonly reconciliation: SalesReconciliationService,
        private readonly lots: SalesLotService,
        private readonly withdrawals: SalesWithdrawalsService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private async nextDeliveryNo(tx: Prisma.TransactionClient, date: Date) {
        const year = String(date.getUTCFullYear()).slice(-2)
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        const period = `${year}${month}`
        const sequence = await tx.documentSequence.upsert({
            where: { moduleCode_period: { moduleCode: 'SALES_DELIVERY', period } },
            create: { moduleCode: 'SALES_DELIVERY', period, currentNo: 1 },
            update: { currentNo: { increment: 1 } },
        })
        return `XK${period}${String(sequence.currentNo).padStart(4, '0')}`
    }

    /**
     * Turns a fully held order into one job per issue warehouse. Idempotent: an order
     * that already has live deliveries is left alone.
     */
    async createForOrder(tx: Prisma.TransactionClient, orderId: string, actor: ScopedActor) {
        const existing = await tx.salesDelivery.count({
            where: { salesOrderId: orderId, status: { not: SalesDeliveryStatus.VOIDED } },
        })
        if (existing) return []

        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            include: {
                customer: { select: { name: true } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: { select: { name: true } },
                        issueWarehouse: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                                legalEntity: { select: { partyId: true } },
                            },
                        },
                    },
                },
                reservations: {
                    where: { status: { in: [ReservationStatus.DRAFT, ReservationStatus.ACTIVE] } },
                    include: { lines: true },
                },
            },
        })

        const heldByLine = new Map<string, { actual: Prisma.Decimal; v15: Prisma.Decimal | null }>()
        for (const reservation of order.reservations) {
            for (const line of reservation.lines) {
                if (!line.salesOrderLineId) continue
                const current = heldByLine.get(line.salesOrderLineId)
                heldByLine.set(line.salesOrderLineId, {
                    actual: (current?.actual ?? new Prisma.Decimal(0)).plus(line.activeActualQty),
                    v15:
                        line.activeV15Qty == null && current?.v15 == null
                            ? null
                            : (current?.v15 ?? new Prisma.Decimal(0)).plus(line.activeV15Qty ?? 0),
                })
            }
        }

        // Group by issue warehouse: each warehouse gets its own job, its own truck and
        // eventually its own inventory posting.
        const byWarehouse = new Map<string, typeof order.lines>()
        for (const line of order.lines) {
            if (!line.issueWarehouse) continue
            if (!heldByLine.get(line.id)?.actual.greaterThan(0)) continue
            const group = byWarehouse.get(line.issueWarehouse.id) ?? []
            group.push(line)
            byWarehouse.set(line.issueWarehouse.id, group)
        }
        if (!byWarehouse.size) return []

        const created: Array<{ id: string; deliveryNo: string; warehouseId: string; warehouseName: string }> = []
        for (const [warehouseId, lines] of byWarehouse) {
            const warehouse = lines[0].issueWarehouse!
            const deliveryNo = await this.nextDeliveryNo(tx, order.orderDate)
            const delivery = await tx.salesDelivery.create({
                data: {
                    deliveryNo,
                    salesOrderId: orderId,
                    warehouseId,
                    status: SalesDeliveryStatus.READY,
                    plannedAt: order.orderDate,
                    // Truck/driver captured by sales on the line become this job's authoritative data.
                    vehiclePlate: lines[0].vehiclePlate,
                    driverName: lines[0].driverName,
                    createdById: actor.userId,
                    lines: {
                        create: lines.map((line, index) => ({
                            lineNo: index + 1,
                            salesOrderLineId: line.id,
                            ownerPartyId: warehouse.legalEntity.partyId,
                            plannedActualQty: heldByLine.get(line.id)!.actual,
                            plannedV15Qty: heldByLine.get(line.id)!.v15,
                        })),
                    },
                },
                select: { id: true, deliveryNo: true },
            })
            created.push({
                id: delivery.id,
                deliveryNo: delivery.deliveryNo,
                warehouseId,
                warehouseName: warehouse.name,
            })

            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: delivery.id,
                eventType: 'CREATE',
                toStatus: SalesDeliveryStatus.READY,
                actorId: actor.userId,
                version: 1,
                metadata: { salesOrderId: orderId, warehouseId },
            })
            await this.emitReady(tx, {
                deliveryId: delivery.id,
                deliveryNo: delivery.deliveryNo,
                version: 1,
                warehouseId,
                warehouseName: warehouse.name,
                orderNo: order.orderNo,
                customerName: order.customer.name,
                vehiclePlate: lines[0].vehiclePlate ?? '',
                excludeUserIds: [],
            })
        }
        return created
    }

    private async emitReady(
        tx: Prisma.TransactionClient,
        args: {
            deliveryId: string
            deliveryNo: string
            version: number
            warehouseId: string
            warehouseName: string
            orderNo: string
            customerName: string
            vehiclePlate: string
            excludeUserIds: string[]
        },
    ) {
        const recipientUserIds = await this.scope.usersForWarehouse(args.warehouseId, [
            PERMISSIONS.sales.deliveryConfirm,
        ])
        await this.notificationOutbox.emit(
            {
                eventType: SALES_NOTIFICATION_EVENTS.DELIVERY_READY,
                aggregateType: 'SALES_DELIVERY',
                aggregateId: args.deliveryId,
                dedupeKey: `${SALES_NOTIFICATION_EVENTS.DELIVERY_READY}:${args.deliveryId}:v${args.version}`,
                payload: {
                    entityType: 'SALES_DELIVERY',
                    entityId: args.deliveryId,
                    workItemSourceType: 'SALES_DELIVERY',
                    workItemSourceId: args.deliveryId,
                    actionRequired: true,
                    sourceVersion: args.version,
                    deliveryNo: args.deliveryNo,
                    orderNo: args.orderNo,
                    customerName: args.customerName,
                    warehouseId: args.warehouseId,
                    warehouseName: args.warehouseName,
                    vehiclePlate: args.vehiclePlate,
                    recipientUserIds,
                    excludeUserIds: args.excludeUserIds,
                },
            },
            tx,
        )
    }

    async list(query: ListSalesDeliveriesQueryDto, actor: ScopedActor) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const allowed = this.scope.allowedWarehouseIds(actor)
        if (allowed !== null && query.warehouseId && !allowed.includes(query.warehouseId)) {
            return { items: [], total: 0, page, limit }
        }

        const where: Prisma.SalesDeliveryWhereInput = {
            status: query.status ? (query.status as SalesDeliveryStatus) : undefined,
            warehouseId: query.warehouseId ?? (allowed === null ? undefined : { in: allowed }),
            salesOrderId: query.salesOrderId ?? undefined,
            plannedAt:
                query.dateFrom || query.dateTo
                    ? {
                          gte: query.dateFrom ? new Date(query.dateFrom) : undefined,
                          lte: query.dateTo ? new Date(query.dateTo) : undefined,
                      }
                    : undefined,
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesDelivery.findMany({
                where,
                include: deliveryDetailInclude,
                orderBy: [{ plannedAt: 'asc' }, { createdAt: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesDelivery.count({ where }),
        ])
        return { items: rows, total, page, limit }
    }

    async detail(id: string, actor: ScopedActor) {
        const delivery = await this.prisma.salesDelivery.findUnique({
            where: { id },
            include: deliveryDetailInclude,
        })
        if (!delivery) throw new NotFoundException('SALES_DELIVERY_NOT_FOUND')
        this.scope.assertCanAct(actor, delivery.warehouseId)
        return delivery
    }

    /**
     * The warehouse never edits sales data. Anything wrong (plate, driver, warehouse,
     * product, quantity) goes back to sales with a reason (spec v1.2 §8.1).
     */
    async returnToSales(id: string, dto: ReturnSalesDeliveryDto, actor: ScopedActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'RETURN_REASON_REQUIRED',
                message: 'Trả lại chỉnh sửa bắt buộc nhập lý do.',
            })
        }
        await this.prisma.$transaction(async (tx) => {
            const delivery = await tx.salesDelivery.findUnique({
                where: { id },
                include: {
                    warehouse: { select: { id: true, name: true } },
                    salesOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            createdById: true,
                            submittedById: true,
                            customer: { select: { name: true } },
                        },
                    },
                },
            })
            if (!delivery) throw new NotFoundException('SALES_DELIVERY_NOT_FOUND')
            this.scope.assertCanAct(actor, delivery.warehouseId)
            if (delivery.status !== SalesDeliveryStatus.READY) {
                throw new BadRequestException({
                    code: 'SALES_DELIVERY_NOT_READY',
                    message: 'Chỉ trả lại được lệnh xuất đang chờ kho xử lý.',
                })
            }

            const nextVersion = delivery.version + 1
            await tx.salesDelivery.update({
                where: { id },
                data: {
                    status: SalesDeliveryStatus.RETURNED,
                    returnedReason: reason,
                    returnedById: actor.userId,
                    returnedAt: new Date(),
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: id,
                eventType: 'RETURN',
                fromStatus: SalesDeliveryStatus.READY,
                toStatus: SalesDeliveryStatus.RETURNED,
                actorId: actor.userId,
                reason,
                version: nextVersion,
            })
            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.DELIVERY_RETURNED,
                    aggregateType: 'SALES_DELIVERY',
                    aggregateId: id,
                    // Version in the key so a second return raises a fresh task (spec v1.2 §13).
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.DELIVERY_RETURNED}:${id}:v${nextVersion}`,
                    payload: {
                        entityType: 'SALES_DELIVERY',
                        entityId: id,
                        workItemSourceType: 'SALES_DELIVERY_FIX',
                        workItemSourceId: id,
                        actionRequired: true,
                        sourceVersion: nextVersion,
                        deliveryNo: delivery.deliveryNo,
                        orderNo: delivery.salesOrder.orderNo,
                        customerName: delivery.salesOrder.customer.name,
                        warehouseName: delivery.warehouse.name,
                        returnedReason: reason,
                        recipientUserIds: [
                            delivery.salesOrder.createdById,
                            delivery.salesOrder.submittedById,
                        ].filter((value): value is string => !!value),
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
            await this.status.recompute(tx, delivery.salesOrderId)
        })
        return this.detail(id, actor)
    }

    /** Sales fixed what the warehouse flagged and hands the job back. */
    async resend(id: string, actor: ScopedActor) {
        await this.prisma.$transaction(async (tx) => {
            const delivery = await tx.salesDelivery.findUnique({
                where: { id },
                include: {
                    warehouse: { select: { id: true, name: true } },
                    salesOrder: {
                        select: { orderNo: true, customer: { select: { name: true } } },
                    },
                },
            })
            if (!delivery) throw new NotFoundException('SALES_DELIVERY_NOT_FOUND')
            if (delivery.status !== SalesDeliveryStatus.RETURNED) {
                throw new BadRequestException({
                    code: 'SALES_DELIVERY_NOT_RETURNED',
                    message: 'Chỉ gửi lại được lệnh xuất kho đã trả lại.',
                })
            }
            const nextVersion = delivery.version + 1
            await tx.salesDelivery.update({
                where: { id },
                data: {
                    status: SalesDeliveryStatus.READY,
                    returnedReason: null,
                    returnedById: null,
                    returnedAt: null,
                    version: { increment: 1 },
                },
            })
            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: id,
                eventType: 'RESEND',
                fromStatus: SalesDeliveryStatus.RETURNED,
                toStatus: SalesDeliveryStatus.READY,
                actorId: actor.userId,
                version: nextVersion,
            })
            await this.emitReady(tx, {
                deliveryId: id,
                deliveryNo: delivery.deliveryNo,
                version: nextVersion,
                warehouseId: delivery.warehouseId,
                warehouseName: delivery.warehouse.name,
                orderNo: delivery.salesOrder.orderNo,
                customerName: delivery.salesOrder.customer.name,
                vehiclePlate: delivery.vehiclePlate ?? '',
                excludeUserIds: actor.userId ? [actor.userId] : [],
            })
            await this.status.recompute(tx, delivery.salesOrderId)
        })
        return this.detail(id, actor)
    }

    /** FIFO proposal for the warehouse screen; the warehouse may pick different lots. */
    async fifoSuggestion(id: string, actor: ScopedActor) {
        const delivery = await this.detail(id, actor)
        const lines = await this.prisma.$transaction(async (tx) =>
            Promise.all(
                delivery.lines.map(async (line: any) => {
                    const plannedQty = new Prisma.Decimal(line.plannedActualQty)
                    const result = await this.issuePosting.suggestAllocations(tx, {
                        warehouseId: delivery.warehouseId,
                        productId: line.orderLine.productId,
                         ownerPartyId: line.ownerPartyId,
                         salesOrderLineId: line.orderLine.id,
                         supplySource: line.orderLine.supplySource,
                         actualQty: plannedQty,
                    })
                    return {
                        salesDeliveryLineId: line.id,
                        lineNo: line.lineNo,
                        productId: line.orderLine.productId,
                        productName: line.orderLine.product.name,
                        plannedActualQty: plannedQty.toString(),
                        ...result,
                    }
                }),
            ),
        )
        return { salesDeliveryId: id, deliveryNo: delivery.deliveryNo, lines }
    }

    /**
     * Xác nhận nhanh: ghi sổ ngay theo số kế hoạch và đúng phương án lô hệ thống đề xuất,
     * không mở form. Dùng cho trường hợp phổ biến là thực xuất đúng bằng kế hoạch — đơn đã
     * được duyệt và giữ lô từ trước nên không có gì để khai thêm.
     *
     * Chạy tuần tự và bắt lỗi từng lệnh: một lệnh hỏng (hết tồn, người khác vừa xác nhận)
     * không được kéo đổ những lệnh còn lại. Lệnh hỏng vẫn nằm nguyên trong hàng đợi để kho
     * mở form xử lý tay.
     */
    async quickConfirm(dto: QuickConfirmSalesDeliveriesDto, actor: ScopedActor) {
        const ids = [...new Set(dto.ids)]
        const rows = await this.prisma.salesDelivery.findMany({
            where: { id: { in: ids } },
            select: { id: true, deliveryNo: true },
        })
        const deliveryNoById = new Map(rows.map((row) => [row.id, row.deliveryNo]))

        const results: Array<{
            id: string
            deliveryNo: string | null
            ok: boolean
            code?: string
            message?: string
        }> = []
        for (const id of ids) {
            const deliveryNo = deliveryNoById.get(id) ?? null
            try {
                const plan = await this.fifoSuggestion(id, actor)
                const shortLine = plan.lines.find((line) =>
                    new Prisma.Decimal(line.shortageQty).greaterThan(0),
                )
                if (shortLine) {
                    throw new BadRequestException({
                        code: 'SALES_DELIVERY_QUICK_CONFIRM_SHORTAGE',
                        message: `Dòng ${shortLine.lineNo} còn thiếu ${shortLine.shortageQty} chưa có lô để xuất — mở form để xử lý.`,
                    })
                }
                await this.confirm(
                    id,
                    {
                        issuedAt: dto.issuedAt,
                        lines: plan.lines.map((line) => ({
                            salesDeliveryLineId: line.salesDeliveryLineId,
                            actualQty: Number(line.plannedActualQty),
                            allocations: line.suggestion.map((row) => ({
                                inventoryLotId: row.inventoryLotId,
                                actualQty: Number(row.actualQty),
                            })),
                        })),
                    },
                    actor,
                )
                results.push({ id, deliveryNo, ok: true })
            } catch (error) {
                // Lỗi nghiệp vụ của Nest gói code/message trong response — lấy đúng chỗ đó
                // để kho đọc được lý do, thay vì nhận một câu chung chung.
                const payload =
                    error instanceof HttpException
                        ? (error.getResponse() as Record<string, unknown>)
                        : null
                results.push({
                    id,
                    deliveryNo,
                    ok: false,
                    code: typeof payload?.code === 'string' ? payload.code : undefined,
                    message:
                        typeof payload?.message === 'string'
                            ? payload.message
                            : error instanceof Error
                              ? error.message
                              : 'Không xác nhận được lệnh xuất.',
                })
            }
        }

        return {
            confirmed: results.filter((row) => row.ok).length,
            failed: results.filter((row) => !row.ok).length,
            results,
        }
    }

    /**
     * The warehouse confirms what actually left. One transaction covers hold consumption,
     * stock posting, cost consumption and every status change (spec v1.2 §8.2).
     */
    async confirm(id: string, dto: ConfirmSalesDeliveryDto, actor: ScopedActor) {
        const effectiveAt = dto.issuedAt ? new Date(dto.issuedAt) : new Date()
        if (Number.isNaN(effectiveAt.getTime())) throw new BadRequestException('ISSUED_AT_INVALID')

        await this.prisma.$transaction(async (tx) => {
            // Chỉ một người được bước vào luồng xác nhận của cùng một lệnh. Dùng try-lock để
            // người bấm sau nhận 409 ngay, không phải chờ transaction của người đầu tiên.
            const lockKey = `sales-delivery-confirm:${id}`
            const [deliveryLock] = await tx.$queryRaw<Array<{ acquired: boolean }>>`
                SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS acquired
            `
            if (!deliveryLock?.acquired) {
                throw new ConflictException({
                    code: 'SALES_DELIVERY_CONFIRM_IN_PROGRESS',
                    message: 'Lệnh xuất đang được người khác xác nhận. Vui lòng tải lại trạng thái lệnh.',
                })
            }

            // Phải đọc trạng thái sau khi đã giữ khóa; dữ liệu đọc trước khóa có thể đã cũ.
            const delivery = await tx.salesDelivery.findUnique({
                where: { id },
                include: {
                    warehouse: { select: { name: true } },
                    salesOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            kind: true,
                            createdById: true,
                            submittedById: true,
                            customer: { select: { name: true } },
                        },
                    },
                    lines: { select: { id: true, lineNo: true, salesOrderLineId: true } },
                },
            })
            if (!delivery) throw new NotFoundException('SALES_DELIVERY_NOT_FOUND')
            this.scope.assertCanAct(actor, delivery.warehouseId)
            if (delivery.status === SalesDeliveryStatus.POSTED) {
                throw new ConflictException({
                    code: 'SALES_DELIVERY_ALREADY_CONFIRMED',
                    message: 'Lệnh xuất đã được người khác xác nhận trước đó.',
                })
            }
            if (delivery.status !== SalesDeliveryStatus.READY) {
                throw new BadRequestException({
                    code: 'SALES_DELIVERY_NOT_READY',
                    message: 'Chỉ xác nhận được lệnh xuất đang chờ kho xử lý.',
                })
            }

            // A SINGLE order line may only be fulfilled once. The conditional update IS the
            // constraint (spec v1.2 P0-2) — zero rows affected means someone got there first.
            if (delivery.salesOrder.kind === SalesOrderKind.SINGLE) {
                for (const line of delivery.lines) {
                    const claimed = await tx.salesOrderLine.updateMany({
                        where: { id: line.salesOrderLineId, effectiveDeliveryLineId: null },
                        data: { effectiveDeliveryLineId: line.id },
                    })
                    if (!claimed.count) {
                        throw new ConflictException({
                            code: 'SALES_ORDER_LINE_ALREADY_ISSUED',
                            message: `Dòng ${line.lineNo} của đơn đã có lần xuất thành công — đơn lấy 1 lần không xuất lại.`,
                        })
                    }
                }
                await this.reservations.reallocateSingleDelivery(tx, id, dto.lines, actor)
            }

            await this.issuePosting.post(tx, {
                salesDeliveryId: id,
                lines: dto.lines.map((line) => ({
                    salesDeliveryLineId: line.salesDeliveryLineId,
                    actualQty: line.actualQty,
                    v15Qty: line.v15Qty ?? null,
                    temperatureC: line.temperatureC ?? null,
                    vcf: line.vcf ?? null,
                    allocations: line.allocations.map((allocation) => ({
                        inventoryLotId: allocation.inventoryLotId,
                        actualQty: allocation.actualQty,
                        v15Qty: allocation.v15Qty ?? null,
                    })),
                })),
                issueDocNo: dto.issueDocNo,
                effectiveAt,
                actorId: actor.userId,
            })

            const nextVersion = delivery.version + 1
            const posted = await tx.salesDelivery.updateMany({
                where: {
                    id,
                    status: SalesDeliveryStatus.READY,
                    version: delivery.version,
                },
                data: {
                    status: SalesDeliveryStatus.POSTED,
                    issueDocNo: dto.issueDocNo?.trim() || null,
                    sourceFileName: dto.sourceFileName?.trim() || null,
                    sourceFileUrl: dto.sourceFileUrl?.trim() || null,
                    deliveredAt: effectiveAt,
                    confirmedById: actor.userId,
                    confirmedAt: new Date(),
                    version: { increment: 1 },
                },
            })
            if (posted.count !== 1) {
                throw new ConflictException({
                    code: 'SALES_DELIVERY_CONFIRM_CONFLICT',
                    message: 'Trạng thái lệnh xuất vừa thay đổi bởi người khác. Vui lòng tải lại.',
                })
            }
            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: id,
                eventType: 'POST',
                fromStatus: SalesDeliveryStatus.READY,
                toStatus: SalesDeliveryStatus.POSTED,
                actorId: actor.userId,
                version: nextVersion,
                metadata: { issueDocNo: dto.issueDocNo ?? null },
            })

            await this.notificationOutbox.emit(
                {
                    eventType: SALES_NOTIFICATION_EVENTS.DELIVERY_POSTED,
                    aggregateType: 'SALES_DELIVERY',
                    aggregateId: id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.DELIVERY_POSTED}:${id}:v${nextVersion}`,
                    payload: {
                        entityType: 'SALES_DELIVERY',
                        entityId: id,
                        // Closes the warehouse task raised by sales.delivery.ready.
                        resolvedActions: ['CONFIRM_SALES_DELIVERY'],
                        workItemSourceType: 'SALES_DELIVERY',
                        workItemSourceId: id,
                        sourceVersion: nextVersion,
                        deliveryNo: delivery.deliveryNo,
                        orderNo: delivery.salesOrder.orderNo,
                        customerName: delivery.salesOrder.customer.name,
                        warehouseName: delivery.warehouse.name,
                        recipientUserIds: [
                            delivery.salesOrder.createdById,
                            delivery.salesOrder.submittedById,
                        ].filter((value): value is string => !!value),
                        recipientPermissionCodes: [PERMISSIONS.sales.reconcile],
                        excludeUserIds: actor.userId ? [actor.userId] : [],
                    },
                },
                tx,
            )
            // A lot draw only counts as drawn once the warehouse confirms it (nguyên tắc 7).
            if (delivery.withdrawalRequestId) {
                for (const line of dto.lines) {
                    const deliveryLine = delivery.lines.find(
                        (row) => row.id === line.salesDeliveryLineId,
                    )
                    if (!deliveryLine) continue
                    await this.lots.applyIssued(
                        tx,
                        deliveryLine.salesOrderLineId,
                        new Prisma.Decimal(line.actualQty),
                        actor.userId,
                    )
                }
                await this.withdrawals.onDeliveryPosted(tx, delivery.withdrawalRequestId)
            }

            // Build the reconciliation before recomputing status: whether the document may
            // move on to invoicing depends on it (spec v1.2 §4.1). A draw reconciles against
            // its withdrawal request, a SINGLE against the order.
            const reconTarget = delivery.withdrawalRequestId
                ? { withdrawalRequestId: delivery.withdrawalRequestId }
                : { salesOrderId: delivery.salesOrderId }
            await this.reconciliation.syncForTarget(tx, reconTarget, actor.userId)
            await this.reconciliation.notifyVariance(tx, reconTarget, actor.userId)
            await this.status.recompute(tx, delivery.salesOrderId)
        })
        return this.detail(id, actor)
    }

    /**
     * Correction after a successful issue (spec v1.2 §9): reverse stock and cost, free the
     * SINGLE line so a revision can post, and optionally raise that revision. The old hold
     * keeps its CONSUMED history — the revision takes a new one (P0-5).
     */
    async voidPosted(id: string, dto: VoidSalesDeliveryDto, actor: ScopedActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'VOID_REASON_REQUIRED',
                message: 'Hủy lệnh xuất đã ghi nhận bắt buộc nhập lý do.',
            })
        }
        const revisionId = await this.prisma.$transaction(async (tx) => {
            const delivery = await tx.salesDelivery.findUnique({
                where: { id },
                include: {
                    salesOrder: { select: { id: true, kind: true, orderDate: true } },
                    lines: true,
                },
            })
            if (!delivery) throw new NotFoundException('SALES_DELIVERY_NOT_FOUND')
            this.scope.assertCanAct(actor, delivery.warehouseId)
            if (delivery.status !== SalesDeliveryStatus.POSTED) {
                throw new BadRequestException({
                    code: 'SALES_DELIVERY_NOT_POSTED',
                    message: 'Chỉ điều chỉnh được lệnh xuất đã ghi nhận thành công.',
                })
            }
            // A live invoice means the tax authority already holds a document for these
            // goods; un-issuing them behind its back would leave the two out of step. The
            // invoice must be cancelled or corrected first (spec v1.2 nguyên tắc 8, §9).
            const liveInvoice = await tx.salesInvoice.findFirst({
                where: {
                    status: SalesInvoiceStatus.ISSUED,
                    ...(delivery.withdrawalRequestId
                        ? { withdrawalRequestId: delivery.withdrawalRequestId }
                        : { salesOrderId: delivery.salesOrderId }),
                },
                select: { id: true, invoiceNoInternal: true, misaInvoiceNo: true },
            })
            if (liveInvoice) {
                throw new ConflictException({
                    code: 'SALES_DELIVERY_HAS_LIVE_INVOICE',
                    message: `Hóa đơn ${liveInvoice.misaInvoiceNo ?? liveInvoice.invoiceNoInternal} đang hiệu lực — phải hủy hoặc điều chỉnh hóa đơn trước khi sửa lệnh xuất.`,
                    salesInvoiceId: liveInvoice.id,
                })
            }

            const now = new Date()
            await this.issuePosting.reverse(tx, {
                salesDeliveryId: id,
                effectiveAt: now,
                actorId: actor.userId,
            })

            // Free the SINGLE fulfilment pointer so the revision may claim it.
            for (const line of delivery.lines) {
                await tx.salesOrderLine.updateMany({
                    where: { id: line.salesOrderLineId, effectiveDeliveryLineId: line.id },
                    data: { effectiveDeliveryLineId: null },
                })
            }

            // Undoing a draw gives the quantity back to the lot balance.
            if (delivery.withdrawalRequestId) {
                for (const line of delivery.lines) {
                    if (line.actualQty == null) continue
                    await this.lots.applyIssued(
                        tx,
                        line.salesOrderLineId,
                        new Prisma.Decimal(line.actualQty).negated(),
                        actor.userId,
                    )
                }
            }

            await tx.salesDelivery.update({
                where: { id },
                data: { status: SalesDeliveryStatus.VOIDED, version: { increment: 1 } },
            })
            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: id,
                eventType: 'VOID',
                fromStatus: SalesDeliveryStatus.POSTED,
                toStatus: SalesDeliveryStatus.VOIDED,
                actorId: actor.userId,
                reason,
                version: delivery.version + 1,
            })

            let createdRevisionId: string | null = null
            if (dto.createRevision) {
                const deliveryNo = await this.nextDeliveryNo(tx, delivery.salesOrder.orderDate)
                const revision = await tx.salesDelivery.create({
                    data: {
                        deliveryNo,
                        salesOrderId: delivery.salesOrderId,
                        warehouseId: delivery.warehouseId,
                        status: SalesDeliveryStatus.READY,
                        plannedAt: delivery.plannedAt,
                        vehiclePlate: delivery.vehiclePlate,
                        driverName: delivery.driverName,
                        vehicleId: delivery.vehicleId,
                        driverId: delivery.driverId,
                        revisionOfId: delivery.id,
                        createdById: actor.userId,
                        note: `Điều chỉnh lệnh xuất ${delivery.deliveryNo}: ${reason}`,
                        lines: {
                            create: delivery.lines.map((line) => ({
                                lineNo: line.lineNo,
                                salesOrderLineId: line.salesOrderLineId,
                                ownerPartyId: line.ownerPartyId,
                                plannedActualQty: line.plannedActualQty,
                                plannedV15Qty: line.plannedV15Qty,
                            })),
                        },
                    },
                    select: { id: true },
                })
                createdRevisionId = revision.id
                await this.events.record(tx, {
                    entityType: 'SALES_DELIVERY',
                    entityId: revision.id,
                    eventType: 'CREATE_REVISION',
                    toStatus: SalesDeliveryStatus.READY,
                    actorId: actor.userId,
                    reason,
                    version: 1,
                    metadata: { revisionOfId: delivery.id },
                })
            }

            await this.status.recompute(tx, delivery.salesOrderId)
            return createdRevisionId
        })

        // A revision needs its own hold before the warehouse can work on it (P0-5).
        if (revisionId) {
            await this.prisma.$transaction(async (tx) => {
                await this.reservations.reserveOrder(tx, (await tx.salesDelivery.findUniqueOrThrow({
                    where: { id: revisionId },
                    select: { salesOrderId: true },
                })).salesOrderId, actor)
            })
        }
        return { voidedId: id, revisionId }
    }

    /** Cancel path: drop jobs that were never worked on. */
    async voidOpenDeliveries(tx: Prisma.TransactionClient, orderId: string, actor: ScopedActor, reason: string) {
        const open = await tx.salesDelivery.findMany({
            where: {
                salesOrderId: orderId,
                status: { in: [SalesDeliveryStatus.DRAFT, SalesDeliveryStatus.READY, SalesDeliveryStatus.RETURNED] },
            },
            select: { id: true, status: true, version: true },
        })
        for (const delivery of open) {
            await tx.salesDelivery.update({
                where: { id: delivery.id },
                data: { status: SalesDeliveryStatus.VOIDED, version: { increment: 1 } },
            })
            await this.events.record(tx, {
                entityType: 'SALES_DELIVERY',
                entityId: delivery.id,
                eventType: 'VOID',
                fromStatus: delivery.status,
                toStatus: SalesDeliveryStatus.VOIDED,
                actorId: actor.userId,
                reason,
                version: delivery.version + 1,
            })
        }
        return open.length
    }

    /** True when the order still has a posted delivery — blocks a plain cancel (§4.1). */
    async hasPostedDelivery(tx: Prisma.TransactionClient, orderId: string) {
        const posted = await tx.salesDelivery.count({
            where: { salesOrderId: orderId, status: SalesDeliveryStatus.POSTED },
        })
        return posted > 0
    }

    /** Orders whose warehouse work is done move on to reconciliation (GĐ 4). */
    async isFullyDelivered(tx: Prisma.TransactionClient, orderId: string) {
        const order = await tx.salesOrder.findUniqueOrThrow({
            where: { id: orderId },
            select: { status: true },
        })
        return order.status === SalesOrderStatus.DELIVERED
    }
}
