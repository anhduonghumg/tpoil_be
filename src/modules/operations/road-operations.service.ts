import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, VehicleDispatchStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    PageQueryDto,
    UpsertDriverDocumentDto,
    UpsertDriverDto,
    UpsertVehicleDispatchDto,
    UpsertVehicleDocumentDto,
    UpsertVehicleDto,
} from './dto/operations.dto'

@Injectable()
export class RoadOperationsService {
    constructor(private readonly prisma: PrismaService) {}

    private page(q: PageQueryDto) {
        return { skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 30), take: q.pageSize ?? 30 }
    }

    async listVehicles(q: PageQueryDto & { supplierCustomerId?: string; isActive?: string }) {
        const where: Prisma.VehicleWhereInput = {
            ...(q.supplierCustomerId ? { supplierCustomerId: q.supplierCustomerId } : {}),
            ...(q.isActive !== undefined ? { isActive: q.isActive === 'true' } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { licensePlate: { contains: q.keyword, mode: 'insensitive' } },
                          { type: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vehicle.findMany({
                where,
                ...this.page(q),
                include: {
                    supplier: { select: { id: true, code: true, name: true } },
                    documents: { orderBy: { expiredDate: 'asc' } },
                },
                orderBy: { licensePlate: 'asc' },
            }),
            this.prisma.vehicle.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    vehicle(id: string) {
        return this.prisma.vehicle.findUniqueOrThrow({
            where: { id },
            include: {
                supplier: true,
                documents: { orderBy: { expiredDate: 'asc' } },
                dispatchOrders: { orderBy: { plannedStartAt: 'desc' }, take: 20 },
            },
        })
    }

    saveVehicle(dto: UpsertVehicleDto, id?: string) {
        const data = {
            supplierCustomerId: dto.supplierCustomerId,
            licensePlate: dto.licensePlate.trim().toUpperCase(),
            type: dto.type?.trim() || null,
            capacity: dto.capacity,
            isActive: dto.isActive ?? true,
            note: dto.note?.trim() || null,
        }
        return id ? this.prisma.vehicle.update({ where: { id }, data }) : this.prisma.vehicle.create({ data })
    }

    saveVehicleDocument(vehicleId: string, dto: UpsertVehicleDocumentDto, id?: string) {
        const data = {
            vehicleId,
            documentType: dto.documentType,
            documentNo: dto.documentNo?.trim() || null,
            issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : null,
            expiredDate: dto.expiredDate ? new Date(dto.expiredDate) : null,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.vehicleDocument.update({ where: { id }, data })
            : this.prisma.vehicleDocument.create({ data })
    }

    async listDrivers(q: PageQueryDto & { supplierCustomerId?: string; isActive?: string }) {
        const where: Prisma.DriverWhereInput = {
            ...(q.supplierCustomerId ? { supplierCustomerId: q.supplierCustomerId } : {}),
            ...(q.isActive !== undefined ? { isActive: q.isActive === 'true' } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { fullName: { contains: q.keyword, mode: 'insensitive' } },
                          { phone: { contains: q.keyword, mode: 'insensitive' } },
                          { idCard: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.driver.findMany({
                where,
                ...this.page(q),
                include: {
                    supplier: { select: { id: true, code: true, name: true } },
                    documents: { orderBy: { expiredDate: 'asc' } },
                },
                orderBy: { fullName: 'asc' },
            }),
            this.prisma.driver.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    driver(id: string) {
        return this.prisma.driver.findUniqueOrThrow({
            where: { id },
            include: {
                supplier: true,
                documents: { orderBy: { expiredDate: 'asc' } },
                dispatchOrders: { orderBy: { plannedStartAt: 'desc' }, take: 20 },
            },
        })
    }

    saveDriver(dto: UpsertDriverDto, id?: string) {
        const data = {
            supplierCustomerId: dto.supplierCustomerId,
            fullName: dto.fullName.trim(),
            phone: dto.phone?.trim() || null,
            idCard: dto.idCard?.trim() || null,
            isActive: dto.isActive ?? true,
            note: dto.note?.trim() || null,
        }
        return id ? this.prisma.driver.update({ where: { id }, data }) : this.prisma.driver.create({ data })
    }

    saveDriverDocument(driverId: string, dto: UpsertDriverDocumentDto, id?: string) {
        const data = {
            driverId,
            documentType: dto.documentType,
            documentNo: dto.documentNo?.trim() || null,
            issuedDate: dto.issuedDate ? new Date(dto.issuedDate) : null,
            expiredDate: dto.expiredDate ? new Date(dto.expiredDate) : null,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.driverDocument.update({ where: { id }, data })
            : this.prisma.driverDocument.create({ data })
    }

    async listDispatches(q: PageQueryDto & { vehicleId?: string; driverId?: string; from?: string; to?: string }) {
        const where: Prisma.VehicleDispatchOrderWhereInput = {
            ...(q.status ? { status: q.status as VehicleDispatchStatus } : {}),
            ...(q.vehicleId ? { vehicleId: q.vehicleId } : {}),
            ...(q.driverId ? { driverId: q.driverId } : {}),
            ...(q.from || q.to
                ? {
                      plannedStartAt: {
                          ...(q.from ? { gte: new Date(q.from) } : {}),
                          ...(q.to ? { lte: new Date(q.to) } : {}),
                      },
                  }
                : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { dispatchNo: { contains: q.keyword, mode: 'insensitive' } },
                          { fromLocationText: { contains: q.keyword, mode: 'insensitive' } },
                          { toLocationText: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vehicleDispatchOrder.findMany({
                where,
                ...this.page(q),
                include: {
                    vehicle: true,
                    driver: true,
                    product: true,
                    fromSupplierLocation: true,
                    toSupplierLocation: true,
                },
                orderBy: { plannedStartAt: 'desc' },
            }),
            this.prisma.vehicleDispatchOrder.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    dispatch(id: string) {
        return this.prisma.vehicleDispatchOrder.findUniqueOrThrow({
            where: { id },
            include: {
                vehicle: { include: { documents: true } },
                driver: { include: { documents: true } },
                product: true,
                fromSupplierLocation: true,
                toSupplierLocation: true,
                warehouseTransfer: true,
            },
        })
    }

    async saveDispatch(dto: UpsertVehicleDispatchDto, id?: string) {
        const conflict = await this.prisma.vehicleDispatchOrder.findFirst({
            where: {
                id: id ? { not: id } : undefined,
                status: { in: [VehicleDispatchStatus.ASSIGNED, VehicleDispatchStatus.LOADING, VehicleDispatchStatus.IN_TRANSIT] },
                plannedStartAt: new Date(dto.plannedStartAt),
                OR: [{ vehicleId: dto.vehicleId }, { driverId: dto.driverId }],
            },
        })
        if (conflict) throw new BadRequestException('Vehicle or driver is already assigned at this time')
        const data = {
            dispatchNo: dto.dispatchNo.trim(),
            sourceType: dto.sourceType,
            sourceId: dto.sourceId ?? null,
            warehouseTransferId: dto.warehouseTransferId ?? null,
            vehicleId: dto.vehicleId,
            driverId: dto.driverId,
            fromLocationText: dto.fromLocationText.trim(),
            toLocationText: dto.toLocationText.trim(),
            fromSupplierLocationId: dto.fromSupplierLocationId ?? null,
            toSupplierLocationId: dto.toSupplierLocationId ?? null,
            productId: dto.productId ?? null,
            plannedQty: dto.plannedQty,
            actualQty: dto.actualQty,
            plannedStartAt: new Date(dto.plannedStartAt),
            actualStartAt: dto.actualStartAt ? new Date(dto.actualStartAt) : null,
            actualEndAt: dto.actualEndAt ? new Date(dto.actualEndAt) : null,
            transportFeeVnd: dto.transportFeeVnd,
            status: dto.status,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.vehicleDispatchOrder.update({ where: { id }, data })
            : this.prisma.vehicleDispatchOrder.create({ data })
    }

    async changeDispatchStatus(id: string, target: VehicleDispatchStatus, at?: string) {
        const row = await this.prisma.vehicleDispatchOrder.findUnique({ where: { id } })
        if (!row) throw new NotFoundException('Dispatch order not found')
        const allowed: Record<VehicleDispatchStatus, VehicleDispatchStatus[]> = {
            DRAFT: [VehicleDispatchStatus.ASSIGNED, VehicleDispatchStatus.CANCELLED],
            ASSIGNED: [VehicleDispatchStatus.LOADING, VehicleDispatchStatus.CANCELLED],
            LOADING: [VehicleDispatchStatus.IN_TRANSIT, VehicleDispatchStatus.CANCELLED],
            IN_TRANSIT: [VehicleDispatchStatus.DELIVERED, VehicleDispatchStatus.CANCELLED],
            DELIVERED: [VehicleDispatchStatus.CLOSED],
            CLOSED: [],
            CANCELLED: [],
        }
        if (!allowed[row.status].includes(target)) throw new BadRequestException(`Invalid transition ${row.status} -> ${target}`)
        const timestamp = at ? new Date(at) : new Date()
        return this.prisma.vehicleDispatchOrder.update({
            where: { id },
            data: {
                status: target,
                ...((target === VehicleDispatchStatus.LOADING || target === VehicleDispatchStatus.IN_TRANSIT) && !row.actualStartAt
                    ? { actualStartAt: timestamp }
                    : {}),
                ...((target === VehicleDispatchStatus.DELIVERED || target === VehicleDispatchStatus.CLOSED)
                    ? { actualEndAt: timestamp }
                    : {}),
            },
        })
    }
}
