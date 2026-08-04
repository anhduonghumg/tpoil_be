import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import {
    NotificationChannel,
    NotificationDeliveryStatus,
    NotificationOutboxStatus,
    Prisma,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationEventBus } from './notification-event-bus.service'
import { NotificationRecipientResolver, RecipientPayload } from './notification-recipient-resolver.service'
import { NotificationTemplateService } from './notification-template.service'

const scalarString = (value: unknown, fallback = '') =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : fallback

@Injectable()
export class NotificationOutboxProcessor implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NotificationOutboxProcessor.name)
    private timer?: NodeJS.Timeout
    private running = false

    constructor(
        private readonly prisma: PrismaService,
        private readonly templates: NotificationTemplateService,
        private readonly recipients: NotificationRecipientResolver,
        private readonly eventBus: NotificationEventBus,
    ) {}

    async onModuleInit() {
        if (process.env.APP_TYPE !== 'worker') return
        await this.prisma.notificationOutbox.updateMany({
            where: {
                status: NotificationOutboxStatus.PROCESSING,
                lockedAt: { lt: new Date(Date.now() - 5 * 60_000) },
            },
            data: { status: NotificationOutboxStatus.PENDING, lockedAt: null },
        })
        this.timer = setInterval(() => void this.tick(), 1_000)
        void this.tick()
    }

    onModuleDestroy() {
        if (this.timer) clearInterval(this.timer)
    }

    private async tick() {
        if (this.running) return
        this.running = true
        try {
            for (let index = 0; index < 25; index += 1) {
                const row = await this.claim()
                if (!row) break
                await this.process(row)
            }
        } finally {
            this.running = false
        }
    }

    private async claim() {
        const candidate = await this.prisma.notificationOutbox.findFirst({
            where: {
                status: NotificationOutboxStatus.PENDING,
                availableAt: { lte: new Date() },
            },
            orderBy: { createdAt: 'asc' },
        })
        if (!candidate) return null
        const claimed = await this.prisma.notificationOutbox.updateMany({
            where: { id: candidate.id, status: NotificationOutboxStatus.PENDING },
            data: {
                status: NotificationOutboxStatus.PROCESSING,
                lockedAt: new Date(),
                attempts: { increment: 1 },
            },
        })
        return claimed.count ? candidate : null
    }

    private async process(outbox: {
        id: string
        eventType: string
        aggregateType: string
        aggregateId: string
        payload: Prisma.JsonValue
        attempts: number
        createdAt: Date
    }) {
        try {
            const payload = (outbox.payload ?? {}) as Record<string, unknown> & RecipientPayload
            const rendered = await this.templates.render(outbox.eventType, payload)
            if (!rendered) {
                await this.prisma.notificationOutbox.update({
                    where: { id: outbox.id },
                    data: {
                        status: NotificationOutboxStatus.PROCESSED,
                        processedAt: new Date(),
                        lockedAt: null,
                        error: null,
                    },
                })
                return
            }
            const resolvedUserIds = await this.recipients.resolve(payload)
            const preferences = resolvedUserIds.length
                ? await this.prisma.notificationPreference.findMany({
                      where: { userId: { in: resolvedUserIds }, category: rendered.category },
                  })
                : []
            const preferenceByUser = new Map(preferences.map((item) => [item.userId, item]))
            const now = new Date()
            const userIds = resolvedUserIds.filter((userId) => {
                const preference = preferenceByUser.get(userId)
                return !preference || (preference.inAppEnabled && (!preference.muteUntil || preference.muteUntil <= now))
            })

            const notification = await this.prisma.$transaction(async (tx) => {
                const created = await tx.notification.upsert({
                    where: { outboxId: outbox.id },
                    create: {
                        outboxId: outbox.id,
                        eventType: outbox.eventType,
                        moduleCode: rendered.moduleCode,
                        category: rendered.category,
                        severity: rendered.severity,
                        title: rendered.title,
                        body: rendered.body,
                        entityType: scalarString(payload.entityType, outbox.aggregateType),
                        entityId: scalarString(payload.entityId, outbox.aggregateId),
                        action: scalarString(payload.action, rendered.action ?? ''),
                        metadata: (payload.metadata ?? payload) as Prisma.InputJsonValue,
                        occurredAt:
                            typeof payload.occurredAt === 'string'
                                ? new Date(payload.occurredAt)
                                : outbox.createdAt,
                    },
                    update: {},
                })

                const resolvedActions = Array.isArray(payload.resolvedActions)
                    ? payload.resolvedActions.map(String)
                    : []
                const workItemSourceType = scalarString(
                    payload.workItemSourceType,
                    scalarString(payload.entityType, outbox.aggregateType),
                )
                const workItemSourceId = scalarString(
                    payload.workItemSourceId,
                    scalarString(payload.entityId, outbox.aggregateId),
                )
                // Version/cycle of the source entity when the event was emitted. Late events
                // must not resurrect or close a work item that a newer state already settled.
                const sourceVersion =
                    typeof payload.sourceVersion === 'number'
                        ? payload.sourceVersion
                        : typeof payload.cycle === 'number'
                          ? payload.cycle
                          : null

                if (resolvedActions.length) {
                    await tx.notificationWorkItem.updateMany({
                        where: {
                            sourceType: workItemSourceType,
                            sourceId: workItemSourceId,
                            action: { in: resolvedActions },
                            status: 'OPEN',
                            ...(sourceVersion == null
                                ? {}
                                : {
                                      OR: [
                                          { sourceVersion: null },
                                          { sourceVersion: { lte: sourceVersion } },
                                      ],
                                  }),
                        },
                        data: { status: 'COMPLETED', completedAt: now, sourceVersion },
                    })
                }

                if (userIds.length) {
                    await tx.notificationRecipient.createMany({
                        data: userIds.map((userId) => ({ notificationId: created.id, userId })),
                        skipDuplicates: true,
                    })
                    const recipientRows = await tx.notificationRecipient.findMany({
                        where: { notificationId: created.id, userId: { in: userIds } },
                        select: { id: true, userId: true },
                    })
                    await tx.notificationDelivery.createMany({
                        data: recipientRows.map((recipient) => ({
                            notificationRecipientId: recipient.id,
                            channel: NotificationChannel.IN_APP,
                            status: NotificationDeliveryStatus.DELIVERED,
                            sentAt: now,
                            deliveredAt: now,
                        })),
                        skipDuplicates: true,
                    })
                    if (payload.actionRequired === true) {
                        for (const userId of userIds) {
                            const sourceType = workItemSourceType
                            const sourceId = workItemSourceId
                            const action = scalarString(payload.action, rendered.action ?? 'VIEW')
                            const dueAt =
                                typeof payload.dueAt === 'string' ? new Date(payload.dueAt) : null
                            const key = { userId, sourceType, sourceId, action }
                            const current = await tx.notificationWorkItem.findUnique({
                                where: { userId_sourceType_sourceId_action: key },
                                select: { id: true, sourceVersion: true },
                            })
                            if (!current) {
                                await tx.notificationWorkItem.create({
                                    data: { ...key, dueAt, sourceVersion },
                                })
                                continue
                            }
                            if (
                                sourceVersion != null &&
                                current.sourceVersion != null &&
                                current.sourceVersion > sourceVersion
                            ) {
                                continue // a newer state already settled this item
                            }
                            await tx.notificationWorkItem.update({
                                where: { id: current.id },
                                data: { status: 'OPEN', completedAt: null, dueAt, sourceVersion },
                            })
                        }
                    }
                }

                await tx.notificationOutbox.update({
                    where: { id: outbox.id },
                    data: {
                        status: NotificationOutboxStatus.PROCESSED,
                        processedAt: now,
                        lockedAt: null,
                        error: null,
                    },
                })
                return created
            })

            try {
                await this.eventBus.publish(notification.id, userIds)
            } catch (error) {
                // PostgreSQL is the source of truth. A transient realtime failure must not
                // recreate an already committed notification; clients will reconcile via API.
                this.logger.warn(
                    `Realtime publish failed for notification ${notification.id}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                )
            }
        } catch (error) {
            const attempts = outbox.attempts + 1
            const dead = attempts >= 5
            const message = error instanceof Error ? error.message : String(error)
            await this.prisma.notificationOutbox.update({
                where: { id: outbox.id },
                data: {
                    status: dead ? NotificationOutboxStatus.DEAD : NotificationOutboxStatus.PENDING,
                    availableAt: new Date(Date.now() + Math.min(60_000, 2 ** attempts * 1_000)),
                    lockedAt: null,
                    error: message.slice(0, 2_000),
                },
            })
            this.logger.error(`Notification outbox ${outbox.id} failed: ${message}`)
        }
    }
}
