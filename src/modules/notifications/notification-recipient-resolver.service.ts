import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type RecipientPayload = {
    recipientUserIds?: string[]
    recipientPermissionCodes?: string[]
    recipientPermissionPrefixes?: string[]
    excludeUserIds?: string[]
}

export type ResolvedNotificationRecipients = {
    /** Everyone who may see the notification, including monitoring admins. */
    userIds: string[]
    /** Only business owners of the action. Observers must never receive an open work item. */
    actionUserIds: string[]
}

@Injectable()
export class NotificationRecipientResolver {
    constructor(private readonly prisma: PrismaService) {}

    async resolve(payload: RecipientPayload): Promise<ResolvedNotificationRecipients> {
        const actionIds = new Set((payload.recipientUserIds ?? []).filter(Boolean))
        const exact = new Set(payload.recipientPermissionCodes ?? [])
        const prefixes = payload.recipientPermissionPrefixes ?? []
        const userIds = new Set<string>()

        const users = await this.prisma.user.findMany({
            where: { isActive: true },
            select: {
                id: true,
                roleBindings: {
                    where: {
                        startAt: { lte: new Date() },
                        OR: [{ endAt: null }, { endAt: { gte: new Date() } }],
                    },
                    select: {
                        role: {
                            select: {
                                perms: {
                                    select: { permission: { select: { code: true } } },
                                },
                            },
                        },
                    },
                },
            },
        })

        const activeUserIds = new Set(users.map((user) => user.id))
        for (const user of users) {
            const permissions = user.roleBindings.flatMap((binding) =>
                binding.role.perms.map((item) => item.permission.code),
            )
            const isAdmin = permissions.includes('system.rbac.admin')
            const matchesBusinessRole = permissions.some(
                (code) => exact.has(code) || prefixes.some((prefix) => code.startsWith(prefix)),
            )
            // Admin receives a monitoring copy of every notification. It is deliberately
            // excluded from actionIds so an observer does not inherit a work queue.
            if (isAdmin) userIds.add(user.id)
            if (matchesBusinessRole) {
                userIds.add(user.id)
                if (!isAdmin) actionIds.add(user.id)
            }
        }

        // Direct recipients must still be active users. Exclusions apply to normal users,
        // while the temporary admin-observer rule remains in force.
        for (const id of [...actionIds]) {
            if (!activeUserIds.has(id)) actionIds.delete(id)
        }
        // A direct recipient can be an administrator too. Administrators receive the
        // notification as observers, unless a future policy explicitly assigns them work.
        for (const id of [...actionIds]) {
            const isAdmin = users.some((user) =>
                user.id === id &&
                user.roleBindings.some((binding) =>
                    binding.role.perms.some((item) => item.permission.code === 'system.rbac.admin'),
                ),
            )
            if (isAdmin) actionIds.delete(id)
            userIds.add(id)
        }
        for (const excluded of payload.excludeUserIds ?? []) {
            actionIds.delete(excluded)
            const isAdmin = users.some((user) =>
                user.id === excluded &&
                user.roleBindings.some((binding) =>
                    binding.role.perms.some((item) => item.permission.code === 'system.rbac.admin'),
                ),
            )
            if (!isAdmin) userIds.delete(excluded)
        }
        return { userIds: [...userIds], actionUserIds: [...actionIds] }
    }
}
