import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, ScopeType } from '@prisma/client'
import { CreateUserDto, UpdateUserDto } from './dto/user.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import * as bcrypt from 'bcrypt'

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
}
