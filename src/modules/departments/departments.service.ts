import { Injectable } from '@nestjs/common'
import { v7 as uuidv7 } from 'uuid'
import { CreateDepartmentDto } from './dto/create-department.dto'
import { UpdateDepartmentDto } from './dto/update-department.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ErrCode } from 'src/common/errors/error-codes'
import { created, fail, paged, success } from 'src/common/http/http.response.util'

@Injectable()
export class DepartmentsService {
    constructor(private prisma: PrismaService) {}

    ALLOWED_PARENT: Record<'board' | 'office' | 'group' | 'branch', Array<'board' | 'office' | 'group' | 'branch'>> = {
        board: [],
        office: ['board'],
        group: ['office'],
        branch: ['group'],
    }

    // Helpers
    private async isCodeTaken(code: string, excludeId?: string) {
        const found = await this.prisma.department.findFirst({
            where: { code, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
            select: { id: true },
        })
        return !!found
    }
    private async departmentExists(id?: string) {
        if (!id) return true
        const success = await this.prisma.department.findUnique({ where: { id } })
        return !!success
    }
    private async siteExists(id?: string) {
        if (!id) return true
        const success = await this.prisma.site.findUnique({ where: { id } })
        return !!success
    }
    private async wouldCreateCycle(parentId?: string, selfId?: string) {
        if (!parentId || !selfId) return false
        let cur = await this.prisma.department.findUnique({ where: { id: parentId }, select: { id: true, parentId: true } })
        while (cur) {
            if (cur.id === selfId) return true
            cur = cur.parentId ? await this.prisma.department.findUnique({ where: { id: cur.parentId }, select: { id: true, parentId: true } }) : null
        }
        return false
    }

    private async isValidParent(childType: string, parentId?: string) {
        if (!parentId) return true
        const parent = await this.prisma.department.findUnique({ where: { id: parentId }, select: { type: true } })
        if (!parent) return false
        const allowed = this.ALLOWED_PARENT[childType as keyof typeof this.ALLOWED_PARENT] ?? []
        return allowed.includes(parent.type as any)
    }

    // CREATE
    async create(dto: CreateDepartmentDto) {
        if (await this.isCodeTaken(dto.code)) {
            return fail(ErrCode.CONFLICT, 'Mã phòng ban đã tồn tại', 409, { code: dto.code })
        }
        if (!(await this.departmentExists(dto.parentId))) {
            return fail(ErrCode.NOT_FOUND, 'Phòng ban cha không tồn tại', 404)
        }
        // if (!(await this.siteExists(dto.siteId))) {
        //     return fail(ErrCode.NOT_FOUND, 'Site không tồn tại', 404)
        // }

        if (!(await this.isValidParent(dto.type, dto.parentId ?? undefined))) {
            return fail(ErrCode.BAD_REQUEST, 'Loại phòng ban cha không hợp lệ cho loại hiện tại', 400)
        }

        const result = await this.prisma.department.create({
            data: {
                id: uuidv7(),
                code: dto.code,
                name: dto.name,
                type: dto.type as any,
                parentId: dto.parentId ?? null,
                siteId: dto.siteId ?? null,
                costCenter: dto.costCenter ?? null,
            },
        })
        return created(result, 'Tạo phòng ban thành công')
    }

    async findMany(query: { q?: string; type?: string; parentId?: string; siteId?: string; page?: number; pageSize?: number; includeDeleted?: 'true' | 'false' }) {
        const where: any = { deletedAt: null }
        if (query.q) {
            where.OR = [{ code: { contains: query.q, mode: 'insensitive' } }, { name: { contains: query.q, mode: 'insensitive' } }]
        }
        if (query.type) where.type = query.type as any
        if (query.parentId) where.parentId = query.parentId
        if (query.siteId) where.siteId = query.siteId

        const page = Math.max(1, Number(query.page ?? 1))
        const pageSize = Math.min(100, Math.max(1, Number(query.pageSize ?? 20)))

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.department.findMany({
                where,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    type: true,
                    parentId: true,
                    siteId: true,
                    costCenter: true,
                    deletedAt: true,
                    createdAt: true,
                    updatedAt: true,
                    parent: { select: { id: true, name: true, code: true } },
                    site: { select: { id: true, name: true, code: true } },
                },
                orderBy: [{ createdAt: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
            this.prisma.department.count({ where }),
        ])

        const items = rows.map((r) => ({
            ...r,
            parentName: r.parent?.name ?? null,
            siteName: r.site?.name ?? null,
        }))

        return paged(items, page, pageSize, total)
    }

    async findAll() {
        const all = await this.prisma.department.findMany({
            where: { deletedAt: null, type: { in: ['office', 'board'] } },
            select: { id: true, name: true },
            orderBy: { name: 'asc' },
        })
        return success(all)
    }

    // TREE (chỉ bản ghi còn sống)
    async findTree(rootId?: string) {
        const all = await this.prisma.department.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'asc' } })
        const byParent = new Map<string | null, any[]>()
        for (const d of all) {
            const k = (d.parentId ?? null) as any
            if (!byParent.has(k)) byParent.set(k, [])
            byParent.get(k)!.push({ ...d, children: [] })
        }
        const attach = (node: any) => {
            const kids = byParent.get(node.id) ?? []
            node.children = kids
            for (const c of kids) attach(c)
        }

        if (rootId) {
            const root = all.find((x) => x.id === rootId)
            if (!root) return fail(ErrCode.NOT_FOUND, 'Không tìm thấy phòng ban gốc', 404)
            const rootNode = { ...root, children: [] }
            attach(rootNode)
            return success(rootNode)
        } else {
            const roots = byParent.get(null) ?? []
            for (const r of roots) attach(r)
            return success(roots)
        }
    }

    // UPDATE
    async update(id: string, dto: UpdateDepartmentDto) {
        const dept = await this.prisma.department.findFirst({ where: { id, deletedAt: null } })
        if (!dept) return fail(ErrCode.NOT_FOUND, 'Department không tồn tại hoặc đã bị xóa', 404)

        if (dto.code && dto.code !== dept.code && (await this.isCodeTaken(dto.code, id))) {
            return fail(ErrCode.CONFLICT, 'Mã phòng ban đã tồn tại', 409, { code: dto.code })
        }
        if (dto.parentId && !(await this.departmentExists(dto.parentId))) {
            return fail(ErrCode.NOT_FOUND, 'Phòng ban cha không tồn tại', 404)
        }
        if (dto.parentId && (await this.wouldCreateCycle(dto.parentId, id))) {
            return fail(ErrCode.BAD_REQUEST, 'Không thể đặt cha gây vòng lặp', 400)
        }
        // if (dto.siteId && !(await this.siteExists(dto.siteId))) {
        //     return fail(ErrCode.NOT_FOUND, 'Site không tồn tại', 404)
        // }

        const updated = await this.prisma.department.update({ where: { id }, data: dto as any })
        return success(updated, 'Cập nhật thành công')
    }

    // SOFT DELETE
    async remove(id: string, byUserId?: string) {
        const dept = await this.prisma.department.findFirst({ where: { id, deletedAt: null } })
        if (!dept) return fail(ErrCode.NOT_FOUND, 'Department không tồn tại hoặc đã bị xóa', 404)

        const child = await this.prisma.department.findFirst({ where: { parentId: id, deletedAt: null } })
        if (child) return fail(ErrCode.CONFLICT, 'Không thể xoá phòng ban còn phòng ban con', 409)

        await this.prisma.department.update({ where: { id }, data: { deletedAt: new Date(), deletedBy: byUserId ?? null } })
        return success(null, 'Xoá phòng ban thành công')
    }

    // RESTORE
    async restore(id: string) {
        const dept = await this.prisma.department.findUnique({ where: { id } })
        if (!dept) return fail(ErrCode.NOT_FOUND, 'Department không tồn tại', 404)
        if (dept.deletedAt == null) return success(dept, 'Phòng ban đang hoạt động')

        if (await this.isCodeTaken(dept.code, id)) {
            return fail(ErrCode.CONFLICT, 'Code đã bị dùng bởi phòng ban khác đang hoạt động', 409, { code: dept.code })
        }

        const restored = await this.prisma.department.update({ where: { id }, data: { deletedAt: null, deletedBy: null } })
        return success(restored, 'Khôi phục thành công')
    }

    async findOne(id: string) {
        const dept = await this.prisma.department.findUnique({ where: { id } })
        if (!dept) return fail(ErrCode.NOT_FOUND, 'Department không tồn tại', 404)
        return success(dept)
    }

    async listSites() {
        const sites = await this.prisma.site.findMany({ orderBy: { name: 'asc' } })
        return success(sites)
    }
}
