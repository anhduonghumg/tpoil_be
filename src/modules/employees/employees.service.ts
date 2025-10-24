import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { Prisma } from '@prisma/client'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { UpdateEmployeeDto } from './dto/update-employee.dto'
import { AppException } from 'src/common/errors/app-exception'
import dayjs from 'dayjs'

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

function normalizeCitizen(citizen?: any) {
    if (!citizen) return undefined
    const fix = { ...citizen }
    const fixDate = (v?: string) => {
        if (!v) return undefined
        const d = dayjs(v, ['DD-MM-YYYY', 'YYYY-MM-DD'], true)
        // Trả về chuỗi ISO rút gọn, Prisma JSON an toàn
        return d.isValid() ? d.format('YYYY-MM-DD') : v
    }
    fix.issuedDate = fixDate(fix.issuedDate)
    fix.expiryDate = fixDate(fix.expiryDate)
    return fix
}

function parseDate(v?: string | Date | null): Date | undefined {
    if (!v) return undefined
    if (v instanceof Date) return v
    const d = dayjs(v, ['DD-MM-YYYY', 'YYYY-MM-DD'], true)
    return d.isValid() ? d.toDate() : undefined
}

function mapCreateInput(dto: CreateEmployeeDto): Prisma.EmployeeCreateInput {
    // JSON fields giữ nguyên; email/phone trim; floor là string
    return {
        code: normStr(dto.code),
        fullName: normStr(dto.fullName),
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
        dob: parseDate(dto.dob),
        joinedAt: parseDate(dto.joinedAt),
        leftAt: parseDate(dto.leftAt),
        // citizen: normalizeCitizen(dto.citizen),

        site: dto.siteId === undefined ? undefined : dto.siteId ? { connect: { id: dto.siteId } } : { disconnect: true },
        manager: dto.managerId === undefined ? undefined : dto.managerId ? { connect: { id: dto.managerId } } : { disconnect: true },
    } as Prisma.EmployeeUpdateInput
}

@Injectable()
export class EmployeesService {
    constructor(private prisma: PrismaService) {}
    async list(params: {
        q?: string
        status?: 'active' | 'inactive' | 'probation' | 'suspended' | 'terminated'
        deptId?: string
        page?: number
        limit?: number
        sortBy?: string
        sortDir?: 'asc' | 'desc'
    }) {
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

        const SORTABLE: Record<string, true> = {
            fullName: true,
        }

        const by = params.sortBy && SORTABLE[params.sortBy] ? params.sortBy : undefined
        const dir: Prisma.SortOrder = params.sortDir === 'desc' ? 'desc' : 'asc'
        // console.log('Sorting by', by, dir)
        const orderBy: Prisma.EmployeeOrderByWithRelationInput[] = by ? [{ [by]: dir } as any, { createdAt: 'desc' }] : [{ createdAt: 'desc' }]

        const [items, total] = await this.prisma.$transaction([
            this.prisma.employee.findMany({
                where,
                skip,
                take,
                orderBy,
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

    async update(id: string, dto: UpdateEmployeeDto) {
        const data = mapUpdateInput(dto) // dùng chung logic bạn đã viết

        try {
            return await this.prisma.$transaction(async (tx) => {
                // 1) Tồn tại & chưa bị soft-delete
                // console.log('Updating employee', id)
                const current = await tx.employee.findFirst({ where: { id, deletedAt: null } })
                if (!current) throw new AppException('NOT_FOUND', 'Không tìm thấy nhân viên')

                // 2) Update employee chính
                const emp = await tx.employee.update({
                    where: { id },
                    data,
                })

                // 3) Đồng bộ memberships nếu client gửi departmentIds
                if (dto.departmentIds) {
                    const desired = dto.departmentIds
                    const cur = await tx.employeeDepartment.findMany({
                        where: { employeeId: id },
                        select: { departmentId: true },
                    })
                    const curIds = cur.map((x) => x.departmentId)

                    const toAdd = desired.filter((d) => !curIds.includes(d))
                    const toDel = curIds.filter((d) => !desired.includes(d))

                    if (toAdd.length) {
                        await tx.employeeDepartment.createMany({
                            data: toAdd.map((d) => ({ employeeId: id, departmentId: d })),
                            skipDuplicates: true,
                        })
                    }
                    if (toDel.length) {
                        await tx.employeeDepartment.deleteMany({
                            where: { employeeId: id, departmentId: { in: toDel } },
                        })
                    }
                }

                return emp
            })
        } catch (e: any) {
            return this.handlePrismaError(e)
        }
    }

    // ====== DELETE ONE ======
    async deleteOne(id: string) {
        const emp = await this.prisma.employee.findFirst({
            where: { id, deletedAt: null },
        })
        if (!emp) throw new AppException('NOT_FOUND', 'Không tìm thấy nhân viên')

        try {
            return await this.prisma.employee.update({
                where: { id },
                data: { deletedAt: new Date() },
            })
        } catch (e: any) {
            return this.handlePrismaError(e)
        }
    }

    // ====== DELETE MANY ======
    async deleteMany(ids: string[]) {
        if (!ids?.length) throw new AppException('VALIDATION_ERROR', 'Không có ID')
        try {
            return await this.prisma.$transaction(async (tx) => {
                const existing = await tx.employee.findMany({
                    where: { id: { in: ids }, deletedAt: null },
                    select: { id: true },
                })
                const foundIds = existing.map((x) => x.id)
                if (!foundIds.length) throw new AppException('NOT_FOUND', 'Không tìm thấy bản ghi hợp lệ')

                await tx.employee.updateMany({
                    where: { id: { in: foundIds } },
                    data: { deletedAt: new Date() },
                })

                return { count: foundIds.length, data: foundIds }
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
            throw new NotFoundException('Không tìm thấy bản ghi:' + e)
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

    async getById(id: string) {
        const emp = await this.prisma.employee.findFirst({
            where: { id, deletedAt: null },
            // include liên quan nếu cần:
            include: {
                // site: true,
                manager: { select: { id: true, fullName: true } },
                memberships: { select: { departmentId: true } },
            },
        })
        if (!emp) throw new AppException('NOT_FOUND', 'Không tìm thấy nhân viên')
        return emp
    }

    async birthdaysInMonth(month?: number) {
        const m = month ?? new Date().getMonth() + 1 // 1..12

        // Postgres
        const rows = await this.prisma.$queryRaw<
            Array<{
                id: string
                full_name: string
                dob: Date | null
                department_name: string | null
                avatar_url: string | null
            }>
        >`
      SELECT e.id,
             e."fullName"      AS full_name,
             e.dob             AS dob,
             e."departmentName" AS department_name,
             e."avatarUrl"     AS avatar_url
      FROM "Employee" e
      WHERE e."deletedAt" IS NULL
        AND e.status IN ('active','probation','suspended')
        AND e.dob IS NOT NULL
        AND EXTRACT(MONTH FROM e.dob) = ${m}
      ORDER BY EXTRACT(DAY FROM e.dob) ASC, e."fullName" ASC
    `
        return rows
    }

    async birthdayCount(month?: number, from: 'today' | 'monthStart' = 'today') {
        const list = await this.birthdaysInMonth(month)
        if (from === 'monthStart') return list.length
        const today = new Date().getDate()
        // 29/02 → nếu năm không nhuận: tính như 28/02
        const year = new Date().getFullYear()
        const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

        const cnt = list.filter((r) => {
            if (!r.dob) return false
            const d = r.dob.getDate()
            if (!isLeap && r.dob.getMonth() + 1 === 2 && d === 29 && today === 28) return true
            return d >= today
        }).length

        return cnt
    }
}
