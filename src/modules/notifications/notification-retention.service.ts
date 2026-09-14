import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { NotificationOutboxStatus, NotificationRecipientStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

const DAY = 24 * 60 * 60 * 1_000

/**
 * Keeps the notification centre compact without removing business audit data. An event is
 * archived from a user's inbox once its display lifetime ends; only the internal outbox and
 * notification rows are purged after 180 archived days.
 */
@Injectable()
export class NotificationRetentionService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NotificationRetentionService.name)
    private timer?: NodeJS.Timeout
    private running = false

    constructor(private readonly prisma: PrismaService) {}

    onModuleInit() {
        if (process.env.APP_TYPE !== 'worker') return
        this.timer = setInterval(() => void this.run(), 6 * 60 * 60 * 1_000)
        void this.run()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }

    private async run() {
        if (this.running) return
        this.running = true
        try {
            const now = new Date()
            await this.prisma.notificationRecipient.updateMany({
                where: {
                    status: { not: NotificationRecipientStatus.ARCHIVED },
                    notification: { expiresAt: { lte: now } },
                },
                data: { status: NotificationRecipientStatus.ARCHIVED, archivedAt: now },
            })

            const purgeBefore = new Date(now.getTime() - 180 * DAY)
            const stale = await this.prisma.notificationOutbox.findMany({
                where: {
                    status: NotificationOutboxStatus.PROCESSED,
                    processedAt: { lt: purgeBefore },
                    notification: {
                        is: {
                            recipients: {
                                every: {
                                    status: NotificationRecipientStatus.ARCHIVED,
                                    archivedAt: { lt: purgeBefore },
                                },
                            },
                        },
                    },
                },
                select: { id: true },
                take: 500,
            })
            if (stale.length) {
                await this.prisma.notificationOutbox.deleteMany({ where: { id: { in: stale.map((item) => item.id) } } })
            }
        } catch (error) {
            this.logger.error(`Notification retention failed: ${error instanceof Error ? error.message : String(error)}`)
        } finally {
            this.running = false
        }
    }
}
