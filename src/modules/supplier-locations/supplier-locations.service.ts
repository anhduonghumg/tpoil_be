import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { MasterStatus, PartyRoleType, Prisma, WarehousePartyRole } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateSupplierLocationDto } from './dto/create-supplier-location.dto'
import { UpdateSupplierLocationDto } from './dto/update-supplier-location.dto'
import { ListSupplierLocationsDto } from './dto/list-supplier-locations.dto'
import { CreateWarehouseAreaDto, UpdateWarehouseAreaDto } from './dto/warehouse-area.dto'

const activeAssignmentWhere = { validTo: null, role: WarehousePartyRole.OPERATOR } as const

@Injectable()
export class SupplierLocationsService {
    constructor(private readonly prisma: PrismaService) {}

    private async defaultLegalEntityId(tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const entity = await tx.legalEntity.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } })
        if (!entity) {
            throw new BadRequestException({
                code: 'LEGAL_ENTITY_REQUIRED',
                message: 'Cần khai báo pháp nhân nội bộ trước khi tạo kho.',
            })
        }
        return entity.id
    }

    private apiWarehouse<T extends { status: MasterStatus; parties?: Array<{ partyId: string; party: unknown }>; warehouseRentalContractLinks?: Array<{ contract: unknown }> }>(row: T) {
        const assignments = row.parties ?? []
        const primary = assignments[0]
        return {
            ...row,
            supplierCustomerId: primary?.partyId ?? null,
            supplierCustomerIds: assignments.map((item) => item.partyId),
            supplier: primary?.party ?? null,
            isActive: row.status === MasterStatus.ACTIVE,
            rentalContracts: (row.warehouseRentalContractLinks ?? []).map((link) => link.contract),
        }
    }

    private async assertValidSuppliers(supplierIds: string[]) {
        const suppliers = await this.prisma.party.findMany({
            where: {
                id: { in: supplierIds },
                deletedAt: null,
                roles: { some: { role: PartyRoleType.SUPPLIER, validTo: null } },
            },
            select: { id: true },
        })
        const validIds = new Set(suppliers.map((supplier) => supplier.id))
        const invalidSupplierIds = supplierIds.filter((id) => !validIds.has(id))
        if (invalidSupplierIds.length) {
            throw new BadRequestException({
                code: 'INVALID_SUPPLIERS',
                message: 'Có đối tác không tồn tại hoặc chưa có vai trò nhà cung cấp.',
                invalidSupplierIds,
            })
        }
    }

    private assignmentFilter(supplierPartyId?: string): Prisma.WarehouseWhereInput {
        return supplierPartyId
            ? {
                  parties: {
                      some: { partyId: supplierPartyId, ...activeAssignmentWhere },
                  },
              }
            : {}
    }

    async listAreas(isActive?: boolean) {
        const rows = await this.prisma.warehouseArea.findMany({
            where: isActive === undefined ? {} : { status: isActive ? MasterStatus.ACTIVE : MasterStatus.INACTIVE },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: { _count: { select: { warehouses: true } } },
        })
        return rows.map((row) => ({ ...row, isActive: row.status === MasterStatus.ACTIVE }))
    }

    async createArea(dto: CreateWarehouseAreaDto) {
        const code = dto.code.trim().toUpperCase()
        const existing = await this.prisma.warehouseArea.findUnique({ where: { code }, select: { id: true } })
        if (existing) throw new BadRequestException({ code: 'WAREHOUSE_AREA_CODE_EXISTS' })
        return this.prisma.warehouseArea.create({
            data: {
                code,
                name: dto.name.trim(),
                note: dto.note?.trim() || null,
                sortOrder: dto.sortOrder ?? 0,
                status: dto.isActive === false ? MasterStatus.INACTIVE : MasterStatus.ACTIVE,
            },
        })
    }

    async updateArea(id: string, dto: UpdateWarehouseAreaDto) {
        const current = await this.prisma.warehouseArea.findUnique({ where: { id }, select: { id: true } })
        if (!current) throw new NotFoundException('Không tìm thấy khu vực kho')
        return this.prisma.warehouseArea.update({
            where: { id },
            data: {
                ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
                ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
                ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
                ...(dto.isActive !== undefined
                    ? { status: dto.isActive ? MasterStatus.ACTIVE : MasterStatus.INACTIVE }
                    : {}),
            },
        })
    }

    private async assertArea(areaId: string) {
        const area = await this.prisma.warehouseArea.findFirst({
            where: { id: areaId, status: MasterStatus.ACTIVE },
            select: { id: true },
        })
        if (!area) throw new BadRequestException({ code: 'WAREHOUSE_AREA_INVALID' })
    }

    async select(q: { supplierCustomerId?: string; keyword?: string; limit?: number; isActive?: boolean }) {
        const keyword = q.keyword?.trim()
        const items = await this.prisma.warehouse.findMany({
            where: {
                ...this.assignmentFilter(q.supplierCustomerId),
                isOperationalWarehouse: true,
                ...(q.isActive ?? true ? { status: MasterStatus.ACTIVE } : {}),
                ...(keyword
                    ? {
                          OR: [
                              { name: { contains: keyword, mode: 'insensitive' } },
                              { code: { contains: keyword, mode: 'insensitive' } },
                              { address: { contains: keyword, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
            take: Math.min(50, Math.max(1, q.limit ?? 20)),
            orderBy: { name: 'asc' },
            select: { id: true, code: true, name: true, areaId: true, area: { select: { id: true, code: true, name: true } } },
        })
        return items.map((item) => ({ ...item, label: `${item.name} (${item.code})` }))
    }

    async list(dto: ListSupplierLocationsDto) {
        const page = dto.page ?? 1
        const pageSize = dto.pageSize ?? 50
        const keyword = dto.keyword?.trim()
        const where: Prisma.WarehouseWhereInput = {
            ...this.assignmentFilter(dto.supplierCustomerId),
            ...(dto.areaId ? { areaId: dto.areaId } : {}),
            ...(dto.isActive !== undefined
                ? { status: dto.isActive === 'true' ? MasterStatus.ACTIVE : { not: MasterStatus.ACTIVE } }
                : {}),
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
        const include = {
            parties: {
                where: activeAssignmentWhere,
                include: { party: { select: { id: true, code: true, name: true } } },
                orderBy: { validFrom: 'asc' as const },
            },
            warehouseRentalContractLinks: {
                where: { contract: { deletedAt: null, contractType: { code: 'WAREHOUSE_RENTAL' } } },
                include: {
                    contract: {
                        include: {
                            attachments: { orderBy: { id: 'asc' as const } },
                            contractType: { select: { code: true } },
                        },
                    },
                },
            },
        }
        const [total, items] = await this.prisma.$transaction([
            this.prisma.warehouse.count({ where }),
            this.prisma.warehouse.findMany({
                where,
                orderBy: [{ status: 'asc' }, { code: 'asc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: { ...include, area: true },
            }),
        ])
        return { items: items.map((item) => this.apiWarehouse(item)), total, page, pageSize }
    }

    async detail(id: string) {
        const row = await this.prisma.warehouse.findUnique({
            where: { id },
            include: {
                parties: {
                    where: activeAssignmentWhere,
                    include: { party: { select: { id: true, code: true, name: true } } },
                    orderBy: { validFrom: 'asc' },
                },
                area: true,
                warehouseRentalContractLinks: {
                    where: { contract: { deletedAt: null, contractType: { code: 'WAREHOUSE_RENTAL' } } },
                    include: {
                        contract: {
                            include: {
                                attachments: { orderBy: { id: 'asc' as const } },
                                contractType: { select: { code: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!row) throw new NotFoundException('Không tìm thấy kho')
        return this.apiWarehouse(row)
    }

    async create(dto: CreateSupplierLocationDto) {
        const supplierIds = [...new Set((dto.supplierCustomerIds ?? []).filter(Boolean))]
        if (supplierIds.length) await this.assertValidSuppliers(supplierIds)
        await this.assertArea(dto.areaId)

        return this.prisma.$transaction(async (tx) => {
            const legalEntityId = await this.defaultLegalEntityId(tx)
            const code = dto.code.trim()
            const existing = await tx.warehouse.findUnique({
                where: { legalEntityId_code: { legalEntityId, code } },
                select: { id: true },
            })
            if (existing) throw new BadRequestException({ code: 'WAREHOUSE_CODE_EXISTS' })

            const warehouse = await tx.warehouse.create({
                data: {
                    legalEntityId,
                    areaId: dto.areaId,
                    code,
                    name: dto.name.trim(),
                    nameInvoice: dto.nameInvoice?.trim() || null,
                    address: dto.address?.trim() || null,
                    status: dto.isActive === false ? MasterStatus.INACTIVE : MasterStatus.ACTIVE,
                    warehouseType: dto.warehouseType?.trim() || null,
                    isOperationalWarehouse: dto.isOperationalWarehouse ?? true,
                    note: dto.note?.trim() || null,
                },
            })
            await tx.warehousePartyAssignment.createMany({
                data: supplierIds.map((partyId) => ({
                    warehouseId: warehouse.id,
                    partyId,
                    role: WarehousePartyRole.OPERATOR,
                    validFrom: new Date(),
                })),
            })
            return { ...warehouse, createdCount: 1, skippedCount: 0, supplierCustomerIds: supplierIds }
        })
    }

    private updateData(dto: UpdateSupplierLocationDto): Prisma.WarehouseUpdateInput {
        return {
            ...(dto.areaId !== undefined ? { area: { connect: { id: dto.areaId } } } : {}),
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.nameInvoice !== undefined ? { nameInvoice: dto.nameInvoice?.trim() || null } : {}),
            ...(dto.address !== undefined ? { address: dto.address?.trim() || null } : {}),
            ...(dto.isActive !== undefined
                ? { status: dto.isActive ? MasterStatus.ACTIVE : MasterStatus.INACTIVE }
                : {}),
            ...(dto.warehouseType !== undefined ? { warehouseType: dto.warehouseType?.trim() || null } : {}),
            ...(dto.isOperationalWarehouse !== undefined
                ? { isOperationalWarehouse: dto.isOperationalWarehouse }
                : {}),
            ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
            version: { increment: 1 },
        }
    }

    async update(id: string, dto: UpdateSupplierLocationDto) {
        if (dto.areaId) await this.assertArea(dto.areaId)
        const current = await this.prisma.warehouse.findUnique({ where: { id }, select: { id: true } })
        if (!current) throw new NotFoundException('Không tìm thấy kho')
        const updated = await this.prisma.warehouse.update({ where: { id }, data: this.updateData(dto) })
        return this.apiWarehouse(updated)
    }

    async batchUpdate(id: string, dto: UpdateSupplierLocationDto) {
        const hasSupplierUpdate = dto.supplierCustomerIds !== undefined
        const supplierIds = [...new Set((dto.supplierCustomerIds ?? []).filter(Boolean))]
        if (hasSupplierUpdate && supplierIds.length) await this.assertValidSuppliers(supplierIds)
        if (dto.areaId) await this.assertArea(dto.areaId)

        return this.prisma.$transaction(async (tx) => {
            const current = await tx.warehouse.findUnique({ where: { id }, select: { id: true } })
            if (!current) throw new NotFoundException('Không tìm thấy kho')
            if (hasSupplierUpdate) {
                const now = new Date()
                await tx.warehousePartyAssignment.updateMany({
                    where: {
                        warehouseId: id,
                        ...activeAssignmentWhere,
                        partyId: { notIn: supplierIds },
                    },
                    data: { validTo: now },
                })
                const active = await tx.warehousePartyAssignment.findMany({
                    where: { warehouseId: id, ...activeAssignmentWhere, partyId: { in: supplierIds } },
                    select: { partyId: true },
                })
                const activeIds = new Set(active.map((item) => item.partyId))
                const newIds = supplierIds.filter((partyId) => !activeIds.has(partyId))
                if (newIds.length) {
                    await tx.warehousePartyAssignment.createMany({
                        data: newIds.map((partyId) => ({
                            warehouseId: id,
                            partyId,
                            role: WarehousePartyRole.OPERATOR,
                            validFrom: now,
                        })),
                    })
                }
            }
            const updated = await tx.warehouse.update({ where: { id }, data: this.updateData(dto) })
            return [{ ...updated, supplierCustomerIds: hasSupplierUpdate ? supplierIds : undefined }]
        })
    }

    async delete(id: string) {
        await this.deactivate(id)
        return true
    }

    async deactivate(id: string) {
        const current = await this.prisma.warehouse.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('Không tìm thấy kho')
        if (current.status !== MasterStatus.ACTIVE) return this.apiWarehouse(current)
        const updated = await this.prisma.warehouse.update({
            where: { id },
            data: { status: MasterStatus.INACTIVE, version: { increment: 1 } },
        })
        return this.apiWarehouse(updated)
    }

    async activate(id: string) {
        const current = await this.prisma.warehouse.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('Không tìm thấy kho')
        if (current.status === MasterStatus.ACTIVE) return this.apiWarehouse(current)
        const updated = await this.prisma.warehouse.update({
            where: { id },
            data: { status: MasterStatus.ACTIVE, version: { increment: 1 } },
        })
        return this.apiWarehouse(updated)
    }
}
