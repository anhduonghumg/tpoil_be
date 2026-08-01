import { Injectable, NotFoundException } from '@nestjs/common'
import { NotificationRecipientStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { RegisterNotificationDeviceDto } from './dto/notification-device.dto'
import { UpdateNotificationPreferenceDto } from './dto/notification-preference.dto'

@Injectable()
export class NotificationsService {
    constructor(private readonly prisma: PrismaService) {}

    async list(userId: string, input: { unreadOnly?: boolean; cursor?: string; limit?: number }) {
        const limit = Math.min(Math.max(input.limit ?? 20, 1), 50)
        const rows = await this.prisma.notificationRecipient.findMany({
            where: {
                userId,
                status: input.unreadOnly ? NotificationRecipientStatus.UNREAD : { not: NotificationRecipientStatus.ARCHIVED },
            },
            include: { notification: true },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: limit + 1,
            ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
        })
        const hasMore = rows.length > limit
        const items = rows.slice(0, limit)
        return {
            items: items.map((row) => ({
                ...row.notification,
                id: row.id,
                notificationId: row.notification.id,
                status: row.status,
                readAt: row.readAt,
                createdAt: row.createdAt,
                recipientId: row.id,
            })),
            nextCursor: hasMore ? items.at(-1)?.id ?? null : null,
        }
    }

    async unreadCount(userId: string) {
        const count = await this.prisma.notificationRecipient.count({
            where: { userId, status: NotificationRecipientStatus.UNREAD },
        })
        return { count }
    }

    async markRead(userId: string, recipientId: string) {
        const result = await this.prisma.notificationRecipient.updateMany({
            where: { id: recipientId, userId, status: NotificationRecipientStatus.UNREAD },
            data: { status: NotificationRecipientStatus.READ, readAt: new Date() },
        })
        if (!result.count) {
            const exists = await this.prisma.notificationRecipient.findFirst({
                where: { id: recipientId, userId },
                select: { id: true },
            })
            if (!exists) throw new NotFoundException('NOTIFICATION_NOT_FOUND')
        }
        return { ok: true }
    }

    async markAllRead(userId: string) {
        const result = await this.prisma.notificationRecipient.updateMany({
            where: { userId, status: NotificationRecipientStatus.UNREAD },
            data: { status: NotificationRecipientStatus.READ, readAt: new Date() },
        })
        return { updated: result.count }
    }

    preferences(userId: string) {
        return this.prisma.notificationPreference.findMany({
            where: { userId },
            orderBy: { category: 'asc' },
        })
    }

    updatePreference(userId: string, dto: UpdateNotificationPreferenceDto) {
        return this.prisma.notificationPreference.upsert({
            where: { userId_category: { userId, category: dto.category } },
            create: {
                userId,
                category: dto.category,
                inAppEnabled: dto.inAppEnabled ?? true,
                pushEnabled: dto.pushEnabled ?? true,
                emailEnabled: dto.emailEnabled ?? false,
                muteUntil: dto.muteUntil ? new Date(dto.muteUntil) : null,
            },
            update: {
                ...(dto.inAppEnabled === undefined ? {} : { inAppEnabled: dto.inAppEnabled }),
                ...(dto.pushEnabled === undefined ? {} : { pushEnabled: dto.pushEnabled }),
                ...(dto.emailEnabled === undefined ? {} : { emailEnabled: dto.emailEnabled }),
                ...(dto.muteUntil === undefined ? {} : { muteUntil: dto.muteUntil ? new Date(dto.muteUntil) : null }),
            },
        })
    }

    async registerDevice(userId: string, dto: RegisterNotificationDeviceDto) {
        if (dto.pushToken) {
            await this.prisma.notificationDevice.updateMany({
                where: { pushToken: dto.pushToken, NOT: { userId, deviceId: dto.deviceId } },
                data: { pushToken: null, enabled: false },
            })
        }
        return this.prisma.notificationDevice.upsert({
            where: { userId_deviceId: { userId, deviceId: dto.deviceId } },
            create: {
                userId,
                deviceId: dto.deviceId,
                platform: dto.platform,
                pushProvider: dto.pushProvider,
                pushToken: dto.pushToken,
                appVersion: dto.appVersion,
                locale: dto.locale ?? 'vi-VN',
            },
            update: {
                platform: dto.platform,
                pushProvider: dto.pushProvider,
                pushToken: dto.pushToken,
                appVersion: dto.appVersion,
                locale: dto.locale ?? 'vi-VN',
                enabled: true,
                lastSeenAt: new Date(),
            },
        })
    }

    disableDevice(userId: string, deviceId: string) {
        return this.prisma.notificationDevice.updateMany({
            where: { userId, deviceId },
            data: { enabled: false, pushToken: null },
        })
    }
}
