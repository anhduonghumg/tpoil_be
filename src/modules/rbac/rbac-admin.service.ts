import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SessionService } from 'src/session/session.service'

import { RoleDetailDto, PermissionItemDto } from './dto/rbac-admin.dto'
import { AppException } from 'src/common/errors/app-exception'
import { UpdateRoleDto } from './dto/update-role.dto'
import { CreateRoleDto } from './dto/create-role.dto'
import { ListRolesQueryDto } from './dto/list-roles.query.dto'

@Injectable()
export class RbacAdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly sessionService: SessionService,
    ) {}

    /**
     * Role list + số user đang dùng
     */
    async getRoles(q: ListRolesQueryDto) {
        const page = q.page ?? 1
        const pageSize = q.pageSize ?? 20
        const skip = (page - 1) * pageSize
        const keyword = q.keyword?.trim()

        const where: Prisma.RoleWhereInput | undefined = keyword
            ? {
                  OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }],
              }
            : undefined

        const [total, roles] = await Promise.all([
            this.prisma.role.count({ where }),
            this.prisma.role.findMany({
                where,
                orderBy: [{ createdAt: 'desc' }],
                skip,
                take: pageSize,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    desc: true,
                    createdAt: true,
                    updatedAt: true,
                    _count: { select: { bindings: true } },
                },
            }),
        ])

        return {
            page,
            pageSize,
            total,
            items: roles.map((r) => ({
                id: r.id,
                code: r.code,
                name: r.name,
                desc: r.desc,
                userCount: r._count.bindings,
                createdAt: r.createdAt,
                updatedAt: r.updatedAt,
            })),
        }
    }
    /**
     * Lấy chi tiết 1 role + tất cả permission (gắn/không gắn)
     * => dùng cho màn Role Detail tab "Quyền"
     */
    async getRoleDetail(roleId: string): Promise<RoleDetailDto> {
        const role = await this.prisma.role.findUnique({
            where: { id: roleId },
            include: {
                perms: {
                    include: {
                        permission: {
                            include: {
                                module: true,
                            },
                        },
                    },
                },
            },
        })

        if (!role) {
            throw new Error('Role không tồn tại')
            // throw new AppException.notFound('Role không tồn tại')
        }

        const allPerms = await this.prisma.permission.findMany({
            include: {
                module: true,
            },
            orderBy: [{ module: { code: 'asc' } }, { code: 'asc' }],
        })

        const assignedIds = new Set(role.perms.map((rp) => rp.permissionId))

        const permissions = allPerms.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            moduleCode: p.module.code,
            moduleName: p.module.name,
            assigned: assignedIds.has(p.id),
        }))

        return {
            id: role.id,
            code: role.code,
            name: role.name,
            desc: role.desc ?? null,
            permissions,
        }
    }

    async createRole(dto: CreateRoleDto) {
        const exists = await this.prisma.role.findUnique({ where: { code: dto.code } })
        if (exists) {
            throw AppException.conflict('Role code đã tồn tại', { code: dto.code })
        }

        const role = await this.prisma.role.create({
            data: {
                code: dto.code,
                name: dto.name,
                desc: dto.desc ?? null,
            },
            select: { id: true, code: true, name: true, desc: true, createdAt: true, updatedAt: true },
        })

        return role
    }

    async updateRole(roleId: string, dto: UpdateRoleDto) {
        const role = await this.prisma.role.findUnique({ where: { id: roleId } })
        if (!role) throw AppException.notFound('Role không tồn tại', { roleId })

        const updated = await this.prisma.role.update({
            where: { id: roleId },
            data: {
                name: dto.name ?? role.name,
                desc: dto.desc ?? role.desc,
            },
            select: { id: true, code: true, name: true, desc: true, createdAt: true, updatedAt: true },
        })

        return updated
    }

    async deleteRole(roleId: string) {
        const role = await this.prisma.role.findUnique({ where: { id: roleId } })
        if (!role) throw AppException.notFound('Role không tồn tại', { roleId })

        const bindingCount = await this.prisma.userRoleBinding.count({ where: { roleId } })
        if (bindingCount > 0) {
            throw AppException.badRequest('Không thể xoá role vì đang được gán cho user', {
                roleId,
                bindingCount,
            })
        }

        await this.prisma.role.delete({ where: { id: roleId } })
        return { ok: true }
    }

    async getAllPermissions(moduleCode?: string): Promise<PermissionItemDto[]> {
        const perms = await this.prisma.permission.findMany({
            where: moduleCode
                ? {
                      module: { code: moduleCode },
                  }
                : undefined,
            include: {
                module: true,
            },
            orderBy: [{ module: { code: 'asc' } }, { code: 'asc' }],
        })

        return perms.map((p) => ({
            id: p.id,
            code: p.code,
            name: p.name,
            moduleCode: p.module.code,
            moduleName: p.module.name,
        }))
    }

    /**
     * Cập nhật danh sách permission của 1 role
     * - Ghi RolePermission
     * - Xoá session của tất cả user đang dùng role này (force login lại)
     */
    async updateRolePermissions(roleId: string, permissionIds: string[]): Promise<void> {
        if (!Array.isArray(permissionIds)) {
            throw AppException.badRequest('permissionIds phải là mảng string')
        }

        if (permissionIds.length === 0) {
            // console.log('lỗi')
            return
        }

        const role = await this.prisma.role.findUnique({ where: { id: roleId } })
        if (!role) throw AppException.notFound('Role không tồn tại', { roleId })

        const count = await this.prisma.permission.count({
            where: { id: { in: permissionIds } },
        })
        if (count !== permissionIds.length) {
            throw AppException.badRequest('Có permissionId không tồn tại', {
                expected: permissionIds.length,
                found: count,
            })
        }

        const bindings = await this.prisma.userRoleBinding.findMany({
            where: { roleId },
            select: { userId: true },
        })
        const userIds = Array.from(new Set(bindings.map((b) => b.userId)))

        await this.prisma.$transaction(async (tx) => {
            await tx.rolePermission.deleteMany({ where: { roleId } })
            await tx.rolePermission.createMany({
                data: permissionIds.map((pid) => ({ roleId, permissionId: pid })),
                skipDuplicates: true,
            })
        })

        if (userIds.length) {
            await Promise.all(userIds.map((uid) => this.sessionService.deleteSessionsByUserId(uid)))
        }
    }
}
