import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateSupplierLocationDto } from './dto/create-supplier-location.dto'
import { UpdateSupplierLocationDto } from './dto/update-supplier-location.dto'
import { ListSupplierLocationsDto } from './dto/list-supplier-locations.dto'

@Injectable()
export class SupplierLocationsService {
    constructor(private readonly prisma: PrismaService) {}

    async select(q: { supplierCustomerId: string; keyword?: string; limit?: number; isActive?: boolean }) {
        const limit = Math.min(50, Math.max(1, q.limit ?? 20))
        const keyword = (q.keyword ?? '').trim()
        const isActive = q.isActive ?? true

        const where: Prisma.SupplierLocationWhereInput = {
            supplierCustomerId: q.supplierCustomerId,
            isActive,
            ...(keyword
                ? {
                      OR: [
                          { name: { contains: keyword, mode: 'insensitive' as const } },
                          { code: { contains: keyword, mode: 'insensitive' as const } },
                          { address: { contains: keyword, mode: 'insensitive' as const } },
                      ],
                  }
                : {}),
        }

        const items = await this.prisma.supplierLocation.findMany({
            where,
            take: limit,
            orderBy: [{ name: 'asc' }],
            select: { id: true, code: true, name: true },
        })

        return items.map((x) => ({
            id: x.id,
            code: x.code,
            name: x.name,
            label: `${x.name} (${x.code})`,
        }))
    }

    async list(dto: ListSupplierLocationsDto) {
        const page = dto.page ?? 1
        const pageSize = dto.pageSize ?? 50
        const keyword = dto.keyword?.trim()

        const where: Prisma.SupplierLocationWhereInput = {
            ...(dto.supplierCustomerId ? { supplierCustomerId: dto.supplierCustomerId } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive === 'true' } : {}),
            ...(keyword
                ? {
                      OR: [
                          { code: { contains: keyword, mode: 'insensitive' } },
                          { name: { contains: keyword, mode: 'insensitive' } },
                          { nameInvoice: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }

        const [total, items] = await Promise.all([
            this.prisma.supplierLocation.count({ where }),
            this.prisma.supplierLocation.findMany({
                where,
                orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    supplierCustomerId: true,
                    code: true,
                    name: true,
                    nameInvoice: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    supplier: { select: { id: true, code: true, name: true } },
                },
            }),
        ])

        return { items, total, page, pageSize }
    }

    async detail(id: string) {
        const row = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!row) throw new NotFoundException('SupplierLocation not found')
        return row
    }

    private async assertValidSuppliers(supplierIds: string[]) {
        const suppliers = await this.prisma.customer.findMany({
            where: { id: { in: supplierIds }, isSupplier: true, deletedAt: null },
            select: { id: true },
        })

        const okIds = new Set(suppliers.map((s) => s.id))
        const invalidIds = supplierIds.filter((id) => !okIds.has(id))
        if (invalidIds.length) {
            throw new BadRequestException({
                code: 'INVALID_SUPPLIERS',
                message: 'Có NCC không hợp lệ hoặc không phải NCC',
                invalidSupplierIds: invalidIds,
            })
        }
    }

    async create(dto: CreateSupplierLocationDto) {
        const code = dto.code.trim()
        const name = dto.name.trim()
        const nameInvoice = dto.nameInvoice?.trim()

        const supplierIds = Array.from(new Set((dto.supplierCustomerIds ?? []).filter(Boolean)))
        if (!supplierIds.length) {
            throw new BadRequestException({ code: 'REQUIRED_SUPPLIERS', message: 'Chọn ít nhất 1 NCC' })
        }

        await this.assertValidSuppliers(supplierIds)

        const existed = await this.prisma.supplierLocation.findMany({
            where: { supplierCustomerId: { in: supplierIds }, code },
            select: { supplierCustomerId: true },
        })

        const existedIds = new Set(existed.map((x) => x.supplierCustomerId))
        const toCreateIds = supplierIds.filter((id) => !existedIds.has(id))

        let createdCount = 0
        if (toCreateIds.length) {
            const r = await this.prisma.supplierLocation.createMany({
                data: toCreateIds.map((supplierCustomerId) => ({
                    supplierCustomerId,
                    code,
                    name,
                    nameInvoice,
                    address: dto.address?.trim() || null,
                    tankCode: dto.tankCode?.trim() || null,
                    tankName: dto.tankName?.trim() || null,
                    isActive: dto.isActive ?? true,
                })),
                skipDuplicates: true,
            })
            createdCount = r.count
        }

        return {
            code,
            name,
            nameInvoice,
            createdCount,
            skippedCount: supplierIds.length - createdCount,
            skippedSupplierIds: Array.from(existedIds),
        }
    }

    async update(id: string, dto: UpdateSupplierLocationDto) {
        const current = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('SupplierLocation not found')

        const data: Prisma.SupplierLocationUpdateInput = {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.nameInvoice !== undefined ? { nameInvoice: dto.nameInvoice.trim() } : {}),
            ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
            ...(dto.tankCode !== undefined ? { tankCode: dto.tankCode?.trim() || null } : {}),
            ...(dto.tankName !== undefined ? { tankName: dto.tankName?.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        }

        return this.prisma.supplierLocation.update({ where: { id }, data })
    }

    async batchUpdate(id: string, dto: UpdateSupplierLocationDto) {
        const current = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('SupplierLocation not found')

        const supplierIds = Array.from(new Set((dto.supplierCustomerIds ?? []).filter(Boolean)))
        if (!supplierIds.length) {
            throw new BadRequestException({ code: 'REQUIRED_SUPPLIERS', message: 'Chọn ít nhất 1 NCC' })
        }

        await this.assertValidSuppliers(supplierIds)

        const code = current.code

        const patch: Prisma.SupplierLocationUpdateInput = {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.nameInvoice !== undefined ? { nameInvoice: dto.nameInvoice.trim() } : {}),
            ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
            ...(dto.tankCode !== undefined ? { tankCode: dto.tankCode?.trim() || null } : {}),
            ...(dto.tankName !== undefined ? { tankName: dto.tankName?.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        }

        return this.prisma.$transaction(async (tx) => {
            const results: Prisma.SupplierLocationGetPayload<true>[] = []

            for (const supplierCustomerId of supplierIds) {
                const row = await tx.supplierLocation.upsert({
                    where: { supplierCustomerId_code: { supplierCustomerId, code } },
                    update: patch,
                    create: {
                        supplierCustomerId,
                        code,
                        name: dto.name?.trim() ?? current.name,
                        nameInvoice: dto.nameInvoice?.trim() ?? current.nameInvoice ?? null,
                        address: dto.address !== undefined ? dto.address?.trim() || null : current.address,
                        tankCode: dto.tankCode !== undefined ? dto.tankCode?.trim() || null : current.tankCode,
                        tankName: dto.tankName !== undefined ? dto.tankName?.trim() || null : current.tankName,
                        isActive: dto.isActive ?? current.isActive,
                    },
                })
                results.push(row)
            }

            return results
        })
    }

    async delete(id: string) {
        const current = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('SupplierLocation not found')

        if (!current.isActive) return true

        await this.prisma.supplierLocation.update({
            where: { id },
            data: { isActive: false },
        })
        return true
    }

    async deactivate(id: string) {
        const current = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('SupplierLocation not found')

        if (!current.isActive) return current

        return this.prisma.supplierLocation.update({
            where: { id },
            data: { isActive: false },
        })
    }

    async activate(id: string) {
        const current = await this.prisma.supplierLocation.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('SupplierLocation not found')

        if (current.isActive) return current

        return this.prisma.supplierLocation.update({
            where: { id },
            data: { isActive: true },
        })
    }
}
