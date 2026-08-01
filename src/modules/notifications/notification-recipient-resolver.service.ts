import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type RecipientPayload = {
    recipientUserIds?: string[]
    recipientPermissionCodes?: string[]
    recipientPermissionPrefixes?: string[]
    excludeUserIds?: string[]
}

@Injectable()
export class NotificationRecipientResolver {
    constructor(private readonly prisma: PrismaService) {}

    async resolve(payload: RecipientPayload): Promise<string[]> {
        const ids = new Set((payload.recipientUserIds ?? []).filter(Boolean))
        const exact = new Set(payload.recipientPermissionCodes ?? [])
        const prefixes = payload.recipientPermissionPrefixes ?? []

        if (exact.size || prefixes.length) {
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

            for (const user of users) {
                const permissions = user.roleBindings.flatMap((binding) =>
                    binding.role.perms.map((item) => item.permission.code),
                )
                if (
                    permissions.includes('system.rbac.admin') ||
                    permissions.some((code) => exact.has(code) || prefixes.some((prefix) => code.startsWith(prefix)))
                ) {
                    ids.add(user.id)
                }
            }
        }

        for (const excluded of payload.excludeUserIds ?? []) ids.delete(excluded)
        return [...ids]
    }
}
