import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ScopeType } from '@prisma/client'
import { CreateUserDto, ResetPasswordDto, UpdateUserDto } from './dto/user.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import * as bcrypt from 'bcrypt'
import { AppException } from 'src/common/errors/app-exception'

@Injectable()
export class UsersService {
    constructor(private readonly prisma: PrismaService) {}

    async list(q: any) {
        const keyword = String(q.keyword ?? '').trim()
        const isActive = q.isActive === undefined ? undefined : String(q.isActive) === '1'
        const hasEmployee = q.hasEmployee === undefined ? undefined : String(q.hasEmployee) === '1'

        const page = Math.max(1, Number(q.page ?? 1))
        const limit = Math.min(200, Math.max(1, Number(q.limit ?? 20)))
        const skip = (page - 1) * limit

        const where: Prisma.UserWhereInput = {
            ...(isActive === undefined ? {} : { isActive }),
            ...(keyword
                ? {
                      OR: [
                          { username: { contains: keyword, mode: 'insensitive' } },
                          { email: { contains: keyword, mode: 'insensitive' } },
                          { name: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
            ...(hasEmployee === undefined ? {} : hasEmployee ? { employee: { isNot: null } } : { employee: { is: null } }),
        }

        const [total, rows] = await Promise.all([
            this.prisma.user.count({ where }),
            this.prisma.user.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    username: true,
                    email: true,
                    name: true,
                    isActive: true,
                    lastLoginAt: true,
                    createdAt: true,
                    employee: {
                        select: { id: true, code: true, fullName: true, status: true },
                    },
                    roleBindings: {
                        where: { scopeType: ScopeType.global, scopeId: null, endAt: null },
                        select: { role: { select: { id: true, code: true, name: true } } },
                    },
                },
            }),
        ])

        const items = rows.map((u) => ({
            ...u,
            rolesGlobal: u.roleBindings.map((b) => b.role),
            roleBindings: undefined,
        }))

        return { total, page, limit, items }
    }

    async detail(id: string) {
        const u = await this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                email: true,
                name: true,
                isActive: true,
                lastLoginAt: true,
                createdAt: true,
                updatedAt: true,
                employee: { select: { id: true, code: true, fullName: true, status: true } },
                roleBindings: {
                    where: { scopeType: ScopeType.global, scopeId: null, endAt: null },
                    select: { role: { select: { id: true, code: true, name: true } } },
                },
            },
        })
        if (!u) throw new NotFoundException('User not found')

        return {
            ...u,
            rolesGlobal: u.roleBindings.map((b) => b.role),
            roleBindings: undefined,
        }
    }

    async listRoles() {
        const roles = await this.prisma.role.findMany({
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, desc: true },
        })
        return { items: roles }
    }

    /*
    async create(dto: CreateUserDto) {
        const passwordHash = await bcrypt.hash(dto.password, 10)

        try {
            const u = await this.prisma.user.create({
                data: {
                    username: dto.username,
                    email: dto.email,
                    password: passwordHash,
                    name: dto.name ?? null,
                    isActive: dto.isActive ?? true,
                },
                select: { id: true },
            })
            return this.detail(u.id)
        } catch (e: any) {
            // P2002 unique
            if (e?.code === 'P2002') throw new ConflictException('Username/Email already exists')
            throw e
        }
    }
        */

    async create(dto: CreateUserDto) {
        const roleIds = Array.from(new Set(dto.roleIds ?? []))
        const employeeId = dto.employeeId ?? null

        if (roleIds.length) {
            const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } })
            if (roles.length !== roleIds.length) throw AppException.badRequest('Some roles do not exist')
        }

        if (employeeId) {
            const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } })
            if (!emp) throw AppException.notFound('Employee not found', { employeeId })
        }

        const hashed = await bcrypt.hash(dto.password, 10)

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
                data: {
                    username: dto.username.trim(),
                    email: dto.email.trim(),
                    name: dto.name ?? null,
                    isActive: dto.isActive ?? true,
                    password: hashed,
                },
                select: { id: true, username: true, email: true, name: true, isActive: true },
            })

            if (employeeId) {
                await tx.employee.updateMany({ where: { userId: user.id }, data: { userId: null } })
                await tx.employee.update({
                    where: { id: employeeId },
                    data: { userId: user.id },
                })
            }

            if (roleIds.length) {
                await tx.userRoleBinding.createMany({
                    data: roleIds.map((roleId) => ({
                        userId: user.id,
                        roleId,
                        scopeType: ScopeType.global,
                        scopeId: null,
                        startAt: new Date(),
                    })),
                    skipDuplicates: true,
                })
            }

            return user
        })
    }

    /*
    async update(id: string, dto: UpdateUserDto) {
        const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } })
        if (!exists) throw new NotFoundException('User not found')

        const data: Prisma.UserUpdateInput = {
            email: dto.email,
            name: dto.name ?? null,
            ...(dto.isActive === undefined ? {} : { isActive: dto.isActive }),
            ...(dto.password ? { password: await bcrypt.hash(dto.password, 10) } : {}),
        }

        try {
            await this.prisma.user.update({ where: { id }, data })
            return this.detail(id)
        } catch (e: any) {
            if (e?.code === 'P2002') throw new ConflictException('Email already exists')
            throw e
        }
    }
        */

    async update(id: string, dto: UpdateUserDto) {
        const roleIds = dto.roleIds ? Array.from(new Set(dto.roleIds)) : undefined
        const employeeId = dto.employeeId ?? undefined

        const existed = await this.prisma.user.findUnique({ where: { id }, select: { id: true } })
        if (!existed) throw AppException.notFound('User not found', { id })

        if (roleIds) {
            if (roleIds.length) {
                const roles = await this.prisma.role.findMany({ where: { id: { in: roleIds } }, select: { id: true } })
                if (roles.length !== roleIds.length) throw AppException.badRequest('Some roles do not exist')
            }
        }

        // validate employee exists if provided (null is allowed => unassign)
        if (employeeId !== undefined && employeeId !== null) {
            const emp = await this.prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } })
            if (!emp) throw AppException.notFound('Employee not found', { employeeId })
        }

        return this.prisma.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id },
                data: {
                    email: dto.email?.trim(),
                    name: dto.name ?? undefined,
                    isActive: dto.isActive ?? undefined,
                },
                select: { id: true, username: true, email: true, name: true, isActive: true },
            })

            if (employeeId !== undefined) {
                await tx.employee.updateMany({ where: { userId: id }, data: { userId: null } })

                if (employeeId) {
                    await tx.employee.update({
                        where: { id: employeeId },
                        data: { userId: id },
                    })
                }
            }

            if (roleIds !== undefined) {
                await tx.userRoleBinding.deleteMany({
                    where: { userId: id, scopeType: ScopeType.global, OR: [{ scopeId: null }, { scopeId: '' }] },
                })

                if (roleIds.length) {
                    await tx.userRoleBinding.createMany({
                        data: roleIds.map((roleId) => ({
                            userId: id,
                            roleId,
                            scopeType: ScopeType.global,
                            scopeId: null,
                            startAt: new Date(),
                        })),
                        skipDuplicates: true,
                    })
                }
            }

            return user
        })
    }

    async setGlobalRoles(userId: string, roleIds: string[]) {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
        if (!u) throw new NotFoundException('User not found')

        const uniq = Array.from(new Set((roleIds ?? []).filter(Boolean)))

        await this.prisma.$transaction(async (tx) => {
            await tx.userRoleBinding.deleteMany({
                where: { userId, scopeType: ScopeType.global, scopeId: null, endAt: null },
            })

            if (uniq.length) {
                await tx.userRoleBinding.createMany({
                    data: uniq.map((roleId) => ({
                        userId,
                        roleId,
                        scopeType: ScopeType.global,
                        scopeId: null,
                        startAt: new Date(),
                        endAt: null,
                    })),
                    skipDuplicates: true,
                })
            }
        })

        return this.detail(userId)
    }

    async setEmployee(userId: string, employeeId: string | null) {
        const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
        if (!u) throw new NotFoundException('User not found')

        await this.prisma.$transaction(async (tx) => {
            await tx.employee.updateMany({
                where: { userId },
                data: { userId: null },
            })

            if (!employeeId) return

            const emp = await tx.employee.findFirst({
                where: { id: employeeId, deletedAt: null },
                select: { id: true, userId: true },
            })
            if (!emp) throw new NotFoundException('Employee not found')

            if (emp.userId && emp.userId !== userId) {
                throw new ConflictException('Employee already bound to another user')
            }

            await tx.employee.update({
                where: { id: employeeId },
                data: { userId },
            })
        })

        return this.detail(userId)
    }

    async remove(id: string) {
        const exists = await this.prisma.user.findUnique({ where: { id }, select: { id: true } })
        if (!exists) throw new NotFoundException('User not found')

        await this.prisma.$transaction(async (tx) => {
            await tx.employee.updateMany({ where: { userId: id }, data: { userId: null } })
            await tx.userRoleBinding.deleteMany({ where: { userId: id } })
            await tx.user.delete({ where: { id } })
        })

        return { ok: true }
    }

    async resetPassword(userId: string, dto: ResetPasswordDto) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true },
        })
        if (!user) throw new NotFoundException('User not found')

        const password = dto.password?.trim()
        if (!password || password?.length < 6) {
            throw new BadRequestException('Password must be at least 6 characters')
        }

        const saltRounds = 10
        const hashed = await bcrypt.hash(password, saltRounds)

        await this.prisma.user.update({
            where: { id: userId },
            data: { password: hashed },
        })

        return { userId, ok: true }
    }
}
