import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Prisma, ReceivableOpenItemStatus } from '@prisma/client'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SALES_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'

const DAY = 24 * 60 * 60 * 1_000

/**
 * An overdue receivable is an alert to the collection team, not a task for every user who
 * can view receivables. Each open item emits only once, on the first worker pass after its
 * due date; payment allocation remains the source of truth for settlement.
 */
@Injectable()
export class SalesReceivableOverdueNotificationService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(SalesReceivableOverdueNotificationService.name)
    private timer?: NodeJS.Timeout
    private running = false

    constructor(
        private readonly prisma: PrismaService,
        private readonly notifications: NotificationOutboxService,
    ) {}

    onModuleInit() {
        if (process.env.APP_TYPE !== 'worker') return
        this.timer = setInterval(() => void this.run(), DAY)
        void this.run()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }

    private async run() {
        if (this.running) return
        this.running = true
        try {
            const today = new Date()
            today.setHours(0, 0, 0, 0)
            const openItems = await this.prisma.receivableOpenItem.findMany({
                where: {
                    status: { in: [ReceivableOpenItemStatus.OPEN, ReceivableOpenItemStatus.PARTIALLY_SETTLED] },
                    dueDate: { lt: today },
                    outstandingAmount: { gt: new Prisma.Decimal(0) },
                },
                select: {
                    id: true,
                    outstandingAmount: true,
                    currency: true,
                    dueDate: true,
                    customer: { select: { name: true } },
                },
                take: 500,
            })
            for (const item of openItems) {
                await this.notifications.emit({
                    eventType: SALES_NOTIFICATION_EVENTS.RECEIVABLE_OVERDUE,
                    aggregateType: 'RECEIVABLE_OPEN_ITEM',
                    aggregateId: item.id,
                    dedupeKey: `${SALES_NOTIFICATION_EVENTS.RECEIVABLE_OVERDUE}:${item.id}`,
                    payload: {
                        entityType: 'RECEIVABLE_OPEN_ITEM',
                        entityId: item.id,
                        customerName: item.customer.name,
                        overdueAmount: `${item.outstandingAmount.toString()} ${item.currency}`,
                        dueDate: item.dueDate?.toISOString().slice(0, 10) ?? '',
                        recipientPermissionCodes: [PERMISSIONS.sales.receivableAllocate],
                    },
                })
            }
        } catch (error) {
            this.logger.error(`Overdue receivable scan failed: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
            this.running = false
        }
    }
}
