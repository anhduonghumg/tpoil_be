import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { Prisma } from '@prisma/client'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { UpdateEmployeeDto } from './dto/update-employee.dto'

type RoleKey = 'manager' | 'director' | 'vp' | 'lead'

function normStr(v?: string) {
    return v?.toString().trim() || undefined
}
function normEmail(v?: string) {
    return v ? v.trim().toLowerCase() : undefined
}
function normPhoneVN(v?: string) {
    if (!v) return undefined
    let s = v.replace(/\s+/g, '')
    s = s.replace(/^\+84/, '0')
    return s
}

function toJsonString(v?: any) {
    if (!v) return undefined
    try {
        return JSON.stringify(v)
    } catch {
        return undefined
    }
}

function mapCreateInput(dto: CreateEmployeeDto): Prisma.EmployeeCreateInput {
    // JSON fields giữ nguyên; email/phone trim; floor là string
    return {
        code: normStr(dto.code),
        fullName: normStr(dto.name),
        gender: dto.gender as any,
        dob: dto.dob,
        nationality: normStr(dto.nationality),
        maritalStatus: normStr(dto.maritalStatus),
        avatarUrl: normStr(dto.avatarUrl),

        workEmail: normEmail(dto.workEmail),
        personalEmail: normEmail(dto.personalEmail),
        phone: normPhoneVN(dto.phone),

        status: (dto.status as any) ?? 'active',
        joinedAt: dto.joinedAt,
        leftAt: dto.leftAt,

        title: normStr(dto.title),
        grade: normStr(dto.grade),
        floor: normStr(dto.floor),
        area: normStr(dto.area),
        desk: normStr(dto.desk),

        accessCardId: normStr(dto.accessCardId),

        citizen: dto.citizen ? (dto.citizen as any) : undefined,
        tax: dto.tax ? (dto.tax as any) : undefined,
        banking: dto.banking ? (dto.banking as any) : undefined,
        emergency: dto.emergency ? (dto.emergency as any) : undefined,
        addressPermanent: toJsonString(dto.addressPermanent),
        addressCurrent: toJsonString(dto.addressTemp),

        // relations
        user: undefined,
        site: dto.siteId ? { connect: { id: dto.siteId } } : undefined,
        manager: dto.managerId ? { connect: { id: dto.managerId } } : undefined,
    } as Prisma.EmployeeCreateInput
}

function mapUpdateInput(dto: UpdateEmployeeDto): Prisma.EmployeeUpdateInput {
    const base = mapCreateInput(dto as any)
    const { site, manager, ...rest } = base as any
    return {
        ...rest,
        site: dto.siteId === undefined ? undefined : dto.siteId ? { connect: { id: dto.siteId } } : { disconnect: true },
        manager: dto.managerId === undefined ? undefined : dto.managerId ? { connect: { id: dto.managerId } } : { disconnect: true },
    } as Prisma.EmployeeUpdateInput
}

@Injectable()
export class EmployeesService {
    constructor(private prisma: PrismaService) {}
    async list(params: { q?: string; status?: 'active' | 'inactive' | 'probation'; deptId?: string; page?: number; limit?: number }) {
        const { q, status, deptId } = params

        const page = Math.max(1, Number(params.page) || 1)
        const take = Math.min(100, Math.max(1, Number(params.limit) || 20))
        const skip = (page - 1) * take

        const where: Prisma.EmployeeWhereInput = {
            deletedAt: null,
            ...(status ? { status } : {}),
            ...(q
                ? {
                      OR: [
                          { fullName: { contains: q, mode: 'insensitive' } },
                          { code: { contains: q, mode: 'insensitive' } },
                          { workEmail: { contains: q, mode: 'insensitive' } },
                          { personalEmail: { contains: q, mode: 'insensitive' } },
                          { phone: { contains: q, mode: 'insensitive' } },
                      ],
                  }
                : {}),
            ...(deptId
                ? {
                      // lọc theo membership phòng ban
                      memberships: {
                          some: { departmentId: deptId },
                      },
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.employee.findMany({
                where,
                skip,
                take,
                orderBy: [{ createdAt: 'desc' }],
                include: {
                    site: true,
                    manager: { select: { id: true, fullName: true } },
                    memberships: { include: { department: true } },
                },
            }),
            this.prisma.employee.count({ where }),
        ])

        return { items, total, page, limit: take }
    }

    async create(dto: CreateEmployeeDto) {
        const data = mapCreateInput(dto)
        try {
            return await this.prisma.$transaction(async (tx) => {
                const emp = await tx.employee.create({ data })
                const deptIds = dto.departmentIds ?? (dto.departmentId ? [dto.departmentId] : [])
                if (deptIds && deptIds.length) {
                    await tx.employeeDepartment.createMany({
                        data: deptIds.map((d) => ({
                            employeeId: emp.id,
                            departmentId: d,
                        })),
                        skipDuplicates: true,
                    })
                }
                return emp
            })
        } catch (e: any) {
            return this.handlePrismaError(e)
        }
    }

    private handlePrismaError(e: any): never {
        if (e?.code === 'P2002') {
            const field = e?.meta?.target?.[0] || 'unique'
            throw new ConflictException(`Trùng dữ liệu ở trường: ${field}`)
        }
        if (e?.code === 'P2025') {
            throw new NotFoundException('Không tìm thấy bản ghi')
        }
        throw new BadRequestException(e?.message || 'Lỗi dữ liệu')
    }

    private whereByRole(role: RoleKey): Prisma.EmployeeWhereInput {
        const ci = (s: string) => ({ title: { contains: s, mode: 'insensitive' as const } })
        switch (role) {
            case 'manager':
                return { OR: [ci('manager')] }
            case 'director':
                return { OR: [ci('director')] }
            case 'vp':
                return { OR: [ci('vp'), ci('vice president')] }
            case 'lead':
                return { OR: [ci('lead'), ci('leader')] }
        }
    }

    async listByRoles(roles?: RoleKey[]) {
        const roleList: RoleKey[] = roles && roles.length ? roles : ['manager', 'director', 'vp', 'lead']

        const where: Prisma.EmployeeWhereInput = {
            deletedAt: null,
            status: 'active',
            OR: roleList.map((r) => this.whereByRole(r)),
        }

        return this.prisma.employee.findMany({
            where,
            select: { id: true, fullName: true },
            orderBy: { fullName: 'asc' },
        })
    }
}
