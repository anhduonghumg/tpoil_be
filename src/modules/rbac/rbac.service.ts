// src/modules/rbac/rbac.service.ts
import { Injectable } from '@nestjs/common'
import { AuthSessionData, EffectiveScope } from 'src/common/auth/auth-session.types'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SessionService } from 'src/session/session.service'

@Injectable()
export class RbacService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly sessionService: SessionService,
    ) {}

    // async updateUserRoles(userId: string, dto: UpdateUserRolesDto) {
    //     // 1. Update role/binding
    //     await this.prisma.$transaction(async (tx) => {
    //         // Xoá binding cũ
    //         await tx.userRoleBinding.deleteMany({ where: { userId } })

    //         // Tạo binding mới
    //         for (const binding of dto.bindings) {
    //             await tx.userRoleBinding.create({
    //                 data: {
    //                     userId,
    //                     roleId: binding.roleId,
    //                     scopeType: binding.scopeType,
    //                     scopeId: binding.scopeId ?? null,
    //                     startAt: new Date(),
    //                 },
    //             })
    //         }
    //     })

    //     const deleted = await this.sessionService.deleteSessionsByUserId(userId)

    //     return {
    //         updated: true,
    //         sessionsCleared: deleted,
    //     }
    // }

    async buildAuthSession(userId: string): Promise<AuthSessionData | null> {
        const now = new Date()

        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            include: {
                employee: true,
                roleBindings: {
                    where: {
                        startAt: { lte: now },
                        OR: [{ endAt: null }, { endAt: { gte: now } }],
                    },
                    include: {
                        role: {
                            include: {
                                perms: {
                                    include: {
                                        permission: true,
                                    },
                                },
                            },
                        },
                    },
                },
            },
        })

        if (!user || !user.isActive) return null

        const roles: AuthSessionData['roles'] = []
        const permissionsSet = new Set<string>()
        const scopes: EffectiveScope[] = []

        for (const binding of user.roleBindings) {
            const role = binding.role
            if (!role) continue

            roles.push({
                id: role.id,
                code: role.code,
                name: role.name,
            })

            // gom permission của role
            for (const rp of role.perms) {
                if (rp.permission) {
                    permissionsSet.add(rp.permission.code)
                }
            }

            scopes.push({
                type: binding.scopeType,
                scopeId: binding.scopeId,
            })
        }

        const sessionData: AuthSessionData = {
            userId: user.id,
            username: user.username,
            email: user.email,
            employeeId: user.employee?.id ?? null,
            roles,
            permissions: Array.from(permissionsSet),
            scopes,
        }

        return sessionData
    }
}
