import { ForbiddenException, Injectable } from '@nestjs/common'
import { ScopeType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type ScopedActor = {
    userId: string | null
    permissions?: string[]
    scopes?: Array<{ type: ScopeType; scopeId?: string | null }>
}

/**
 * Warehouse-level access for the sales delivery queue (spec v1.2 §12).
 *
 * A `site` role binding carries the warehouse id in `scopeId`; a `global` binding (the
 * default for existing users) or the rbac admin permission grants every warehouse.
 * Enforced in the service layer, not just when filtering lists.
 */
@Injectable()
export class SalesWarehouseScopeService {
    constructor(private readonly prisma: PrismaService) {}

    /** Returns null when the actor may act on ANY warehouse. */
    allowedWarehouseIds(actor: ScopedActor): string[] | null {
        if (actor.permissions?.includes('system.rbac.admin')) return null
        const scopes = actor.scopes ?? []
        if (!scopes.length) return null // no scope information: fall back to permission-only checks
        if (scopes.some((scope) => scope.type === ScopeType.global)) return null
        const warehouseIds = scopes
            .filter((scope) => scope.type === ScopeType.site && scope.scopeId)
            .map((scope) => scope.scopeId as string)
        return [...new Set(warehouseIds)]
    }

    assertCanAct(actor: ScopedActor, warehouseId: string) {
        const allowed = this.allowedWarehouseIds(actor)
        if (allowed === null) return
        if (!allowed.includes(warehouseId)) {
            throw new ForbiddenException({
                code: 'SALES_WAREHOUSE_OUT_OF_SCOPE',
                message: 'Bạn không phụ trách kho này.',
            })
        }
    }

    /** Users who may confirm/return work at a warehouse — used to route notifications. */
    async usersForWarehouse(warehouseId: string, permissionCodes: string[]) {
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
                        scopeType: true,
                        scopeId: true,
                        role: { select: { perms: { select: { permission: { select: { code: true } } } } } },
                    },
                },
            },
        })

        const matched: string[] = []
        for (const user of users) {
            let hasPermission = false
            let inScope = false
            for (const binding of user.roleBindings) {
                const codes = binding.role.perms.map((item) => item.permission.code)
                const grants =
                    codes.includes('system.rbac.admin') ||
                    codes.some((code) => permissionCodes.includes(code))
                if (!grants) continue
                hasPermission = true
                if (
                    binding.scopeType === ScopeType.global ||
                    (binding.scopeType === ScopeType.site && binding.scopeId === warehouseId)
                ) {
                    inScope = true
                }
            }
            if (hasPermission && inScope) matched.push(user.id)
        }
        return matched
    }
}
