import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SalesTransportRequestStatus, VehicleDispatchStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    PageQueryDto,
    UpsertDriverDocumentDto,
    UpsertDriverDto,
    UpsertSalesTransportActualDto,
    UpsertTransportVehicleSettingDto,
    UpsertVehicleFuelLogDto,
    UpsertVehicleMaintenanceExpenseDto,
    UpsertVehicleMonthlyFixedCostDto,
    UpsertVehicleDispatchDto,
    UpsertVehicleDocumentDto,
    UpsertVehicleDto,
} from './dto/operations.dto'

@Injectable()
export class RoadOperationsService {
    constructor(private readonly prisma: PrismaService) {}

    private page(q: PageQueryDto) {
        const page = Math.max(Number(q.page ?? 1) || 1, 1)
        const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200)
        return { skip: (page - 1) * pageSize, take: pageSize }
    }

    private transportFinancials(request: {
        salesOrder: { lines: Array<{ orderedActualQty: Prisma.Decimal; transportFeeUnitPrice: Prisma.Decimal }> }
        actual?: {
            tripDistanceKm: Prisma.Decimal
            fuelConsumptionPer100: Prisma.Decimal
            fuelConsumedQty: Prisma.Decimal
            fuelUnitPrice: Prisma.Decimal
            warehouseEntryFee: Prisma.Decimal
            tollAndTerminalFee: Prisma.Decimal
            portDeliverySurcharge: Prisma.Decimal
            stationAgencyDutyFee: Prisma.Decimal
            portTicketFee: Prisma.Decimal
            invoiceIssuanceFee: Prisma.Decimal
            driverAllowance: Prisma.Decimal
            loadingUnloadingFee: Prisma.Decimal
            otherExpense: Prisma.Decimal
        } | null
    }) {
        const transportRevenue = request.salesOrder.lines.reduce(
            (sum, line) => sum.plus(new Prisma.Decimal(line.orderedActualQty).mul(line.transportFeeUnitPrice)),
            new Prisma.Decimal(0),
        )
        const actual = request.actual
        const fuelCost = actual
            ? new Prisma.Decimal(actual.fuelConsumedQty).mul(actual.fuelUnitPrice)
            : new Prisma.Decimal(0)
        const totalCost = actual
            ? fuelCost
                  .plus(actual.tollAndTerminalFee)
                  .plus(actual.warehouseEntryFee)
                  .plus(actual.portDeliverySurcharge)
                  .plus(actual.stationAgencyDutyFee)
                  .plus(actual.portTicketFee)
                  .plus(actual.invoiceIssuanceFee)
                  .plus(actual.driverAllowance)
                  .plus(actual.loadingUnloadingFee)
                  .plus(actual.otherExpense)
            : new Prisma.Decimal(0)
        return {
            transportFeeAmount: transportRevenue.toString(),
            fuelCost: fuelCost.toString(),
            totalCost: totalCost.toString(),
            grossProfit: transportRevenue.minus(totalCost).toString(),
        }
    }

    private transportMissingFields(actual?: {
        actualTripDate: Date | null
        actualVehiclePlate: string | null
        actualDriverName: string | null
        tripDistanceKm: Prisma.Decimal
        fuelConsumptionPer100: Prisma.Decimal
        fuelUnitPrice: Prisma.Decimal
    } | null) {
        if (!actual) return ['Ngày chạy thực tế', 'BKS thực tế', 'Lái xe thực tế', 'Khoảng cách', 'Định mức nhiên liệu', 'Giá nhiên liệu']
        const missing: string[] = []
        if (!actual.actualTripDate) missing.push('Ngày chạy thực tế')
        if (!actual.actualVehiclePlate?.trim()) missing.push('BKS thực tế')
        if (!actual.actualDriverName?.trim()) missing.push('Lái xe thực tế')
        if (new Prisma.Decimal(actual.tripDistanceKm).lessThanOrEqualTo(0)) missing.push('Khoảng cách')
        if (new Prisma.Decimal(actual.fuelConsumptionPer100).lessThanOrEqualTo(0)) missing.push('Định mức nhiên liệu')
        if (new Prisma.Decimal(actual.fuelUnitPrice).lessThanOrEqualTo(0)) missing.push('Giá nhiên liệu')
        return missing
    }

    private transportSettingFor(vehiclePlate?: string | null, effectiveDate?: Date) {
        if (!vehiclePlate?.trim()) return Promise.resolve(null)
        return this.prisma.transportVehicleSetting.findFirst({
            where: {
                vehiclePlate: vehiclePlate.trim().toUpperCase(),
                effectiveFrom: { lte: effectiveDate ?? new Date() },
            },
            orderBy: { effectiveFrom: 'desc' },
        })
    }

    async listTransportVehicleSettings(q: PageQueryDto) {
        const where: Prisma.TransportVehicleSettingWhereInput = q.keyword
            ? { vehiclePlate: { contains: q.keyword.trim().toUpperCase(), mode: 'insensitive' } }
            : {}
        const [items, total] = await this.prisma.$transaction([
            this.prisma.transportVehicleSetting.findMany({
                where,
                ...this.page(q),
                orderBy: [{ vehiclePlate: 'asc' }, { effectiveFrom: 'desc' }],
            }),
            this.prisma.transportVehicleSetting.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveTransportVehicleSetting(dto: UpsertTransportVehicleSettingDto, id?: string) {
        const data = {
            vehiclePlate: dto.vehiclePlate.trim().toUpperCase(),
            effectiveFrom: new Date(dto.effectiveFrom),
            fuelConsumptionPer100: dto.fuelConsumptionPer100,
            fuelUnitPrice: dto.fuelUnitPrice,
            defaultTripAllowance: dto.defaultTripAllowance ?? 0,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.transportVehicleSetting.update({ where: { id }, data })
            : this.prisma.transportVehicleSetting.create({ data })
    }

    async listVehicleFuelLogs(q: PageQueryDto) {
        const where: Prisma.VehicleFuelLogWhereInput = q.keyword
            ? {
                  OR: [
                      { vehiclePlate: { contains: q.keyword.trim().toUpperCase(), mode: 'insensitive' } },
                      { fueledBy: { contains: q.keyword, mode: 'insensitive' } },
                  ],
              }
            : {}
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vehicleFuelLog.findMany({ where, ...this.page(q), orderBy: { fueledAt: 'desc' } }),
            this.prisma.vehicleFuelLog.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveVehicleFuelLog(dto: UpsertVehicleFuelLogDto, id?: string) {
        const liters = new Prisma.Decimal(dto.liters)
        const unitPrice = new Prisma.Decimal(dto.unitPrice)
        const data = {
            vehiclePlate: dto.vehiclePlate.trim().toUpperCase(),
            fueledAt: new Date(dto.fueledAt),
            odometerKm: dto.odometerKm ?? null,
            liters,
            unitPrice,
            amount: liters.mul(unitPrice),
            fueledBy: dto.fueledBy?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id ? this.prisma.vehicleFuelLog.update({ where: { id }, data }) : this.prisma.vehicleFuelLog.create({ data })
    }

    async listVehicleMaintenanceExpenses(q: PageQueryDto) {
        const where: Prisma.VehicleMaintenanceExpenseWhereInput = q.keyword
            ? {
                  OR: [
                      { vehiclePlate: { contains: q.keyword.trim().toUpperCase(), mode: 'insensitive' } },
                      { description: { contains: q.keyword, mode: 'insensitive' } },
                      { supplierName: { contains: q.keyword, mode: 'insensitive' } },
                  ],
              }
            : {}
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vehicleMaintenanceExpense.findMany({ where, ...this.page(q), orderBy: { documentDate: 'desc' } }),
            this.prisma.vehicleMaintenanceExpense.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveVehicleMaintenanceExpense(dto: UpsertVehicleMaintenanceExpenseDto, id?: string) {
        const amountBeforeTax = new Prisma.Decimal(dto.amountBeforeTax ?? 0)
        const taxAmount = new Prisma.Decimal(dto.taxAmount ?? 0)
        const data = {
            vehiclePlate: dto.vehiclePlate.trim().toUpperCase(),
            documentDate: new Date(dto.documentDate),
            description: dto.description.trim(),
            amountBeforeTax,
            taxAmount,
            totalAmount: amountBeforeTax.plus(taxAmount),
            invoiceStatus: dto.invoiceStatus?.trim() || null,
            supplierName: dto.supplierName?.trim() || null,
            allocationMonths: dto.allocationMonths ?? 1,
            odometerKm: dto.odometerKm ?? null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.vehicleMaintenanceExpense.update({ where: { id }, data })
            : this.prisma.vehicleMaintenanceExpense.create({ data })
    }

    async listVehicleMonthlyFixedCosts(q: PageQueryDto) {
        const where: Prisma.VehicleMonthlyFixedCostWhereInput = q.keyword
            ? { vehiclePlate: { contains: q.keyword.trim().toUpperCase(), mode: 'insensitive' } }
            : {}
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vehicleMonthlyFixedCost.findMany({ where, ...this.page(q), orderBy: { month: 'desc' } }),
            this.prisma.vehicleMonthlyFixedCost.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveVehicleMonthlyFixedCost(dto: UpsertVehicleMonthlyFixedCostDto, id?: string) {
        const month = new Date(dto.month)
        month.setUTCDate(1)
        const data = {
            vehiclePlate: dto.vehiclePlate.trim().toUpperCase(),
            month,
            depreciationCost: dto.depreciationCost ?? 0,
            driverSalaryCost: dto.driverSalaryCost ?? 0,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.vehicleMonthlyFixedCost.update({ where: { id }, data })
            : this.prisma.vehicleMonthlyFixedCost.create({ data })
    }

    async vehicleEfficiencyReport(q: PageQueryDto & { from?: string; to?: string; vehiclePlate?: string }) {
        const from = q.from ? new Date(q.from) : new Date(new Date().getFullYear(), 0, 1)
        const to = q.to ? new Date(q.to) : new Date()
        const toExclusive = new Date(to)
        toExclusive.setDate(toExclusive.getDate() + 1)
        const vehiclePlate = q.vehiclePlate?.trim().toUpperCase()
        const [trips, fuelLogs, maintenance, fixedCosts] = await Promise.all([
            this.prisma.salesOrderTransportRequest.findMany({
                where: {
                    status: SalesTransportRequestStatus.COMPLETED,
                    actual: {
                        actualTripDate: { gte: from, lt: toExclusive },
                        ...(vehiclePlate ? { actualVehiclePlate: vehiclePlate } : {}),
                    },
                },
                include: {
                    actual: true,
                    salesOrder: { select: { lines: { where: { isTransportFeeApplicable: true }, select: { orderedActualQty: true, transportFeeUnitPrice: true } } } },
                },
            }),
            this.prisma.vehicleFuelLog.findMany({
                where: { fueledAt: { gte: from, lt: toExclusive }, ...(vehiclePlate ? { vehiclePlate } : {}) },
            }),
            this.prisma.vehicleMaintenanceExpense.findMany({
                where: { documentDate: { lt: toExclusive }, ...(vehiclePlate ? { vehiclePlate } : {}) },
            }),
            this.prisma.vehicleMonthlyFixedCost.findMany({
                where: { month: { gte: new Date(Date.UTC(from.getFullYear(), from.getMonth(), 1)), lt: toExclusive }, ...(vehiclePlate ? { vehiclePlate } : {}) },
            }),
        ])
        const groups = new Map<string, any>()
        const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        const ensure = (plate: string, month: string) => {
            const key = `${plate}|${month}`
            if (!groups.has(key)) groups.set(key, {
                vehiclePlate: plate, month, tripCount: 0, totalDistanceKm: new Prisma.Decimal(0), expectedFuelLiters: new Prisma.Decimal(0),
                actualFuelLiters: new Prisma.Decimal(0), actualFuelAmount: new Prisma.Decimal(0), transportRevenue: new Prisma.Decimal(0),
                tripCost: new Prisma.Decimal(0), depreciationCost: new Prisma.Decimal(0), driverSalaryCost: new Prisma.Decimal(0), maintenanceAllocated: new Prisma.Decimal(0),
            })
            return groups.get(key)
        }
        for (const trip of trips) {
            if (!trip.actual?.actualTripDate || !trip.actual.actualVehiclePlate) continue
            const row = ensure(trip.actual.actualVehiclePlate, monthKey(trip.actual.actualTripDate))
            const financial = this.transportFinancials(trip as any)
            row.tripCount += 1
            row.totalDistanceKm = row.totalDistanceKm.plus(trip.actual.tripDistanceKm)
            row.expectedFuelLiters = row.expectedFuelLiters.plus(trip.actual.fuelConsumedQty)
            row.transportRevenue = row.transportRevenue.plus(financial.transportFeeAmount)
            row.tripCost = row.tripCost.plus(financial.totalCost)
        }
        for (const log of fuelLogs) {
            const row = ensure(log.vehiclePlate, monthKey(log.fueledAt))
            row.actualFuelLiters = row.actualFuelLiters.plus(log.liters)
            row.actualFuelAmount = row.actualFuelAmount.plus(log.amount)
        }
        for (const cost of fixedCosts) {
            const row = ensure(cost.vehiclePlate, monthKey(cost.month))
            row.depreciationCost = row.depreciationCost.plus(cost.depreciationCost)
            row.driverSalaryCost = row.driverSalaryCost.plus(cost.driverSalaryCost)
        }
        for (const expense of maintenance) {
            const start = new Date(expense.documentDate)
            const monthlyAmount = new Prisma.Decimal(expense.totalAmount).div(expense.allocationMonths)
            for (let i = 0; i < expense.allocationMonths; i += 1) {
                const allocationDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1))
                if (allocationDate < from || allocationDate >= toExclusive) continue
                const row = ensure(expense.vehiclePlate, monthKey(allocationDate))
                row.maintenanceAllocated = row.maintenanceAllocated.plus(monthlyAmount)
            }
        }
        const items = [...groups.values()].map((row) => {
            const grossProfit = row.transportRevenue.minus(row.tripCost)
            const fixedCost = row.depreciationCost.plus(row.driverSalaryCost).plus(row.maintenanceAllocated)
            return {
                vehiclePlate: row.vehiclePlate,
                month: row.month,
                tripCount: row.tripCount,
                totalDistanceKm: row.totalDistanceKm.toString(), expectedFuelLiters: row.expectedFuelLiters.toString(), actualFuelLiters: row.actualFuelLiters.toString(), actualFuelAmount: row.actualFuelAmount.toString(),
                fuelVarianceLiters: row.actualFuelLiters.minus(row.expectedFuelLiters).toString(), transportRevenue: row.transportRevenue.toString(), tripCost: row.tripCost.toString(),
                grossProfit: grossProfit.toString(), depreciationCost: row.depreciationCost.toString(), driverSalaryCost: row.driverSalaryCost.toString(), maintenanceAllocated: row.maintenanceAllocated.toString(),
                profitAfterFixed: grossProfit.minus(fixedCost).toString(),
            }
        }).sort((a, b) => `${b.month}${b.vehiclePlate}`.localeCompare(`${a.month}${a.vehiclePlate}`))
        return { items, from, to }
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
        return {
            items: items.map((item) => ({
                ...item,
                warehouseTransferId: item.inventoryMovementId,
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    /**
     * Queue created from retail sales orders that charge transport. This is deliberately
     * separate from VehicleDispatchOrder: the latter is a concrete trip and may later
     * combine several orders/lines.
     */
    async listSalesTransportRequests(q: PageQueryDto) {
        const where: Prisma.SalesOrderTransportRequestWhereInput = {
            ...(q.status
                ? { status: q.status as SalesTransportRequestStatus }
                : { status: { not: SalesTransportRequestStatus.CANCELLED } }),
            ...(q.keyword
                ? {
                      OR: [
                          { plannedVehiclePlate: { contains: q.keyword, mode: 'insensitive' } },
                          { plannedDriverName: { contains: q.keyword, mode: 'insensitive' } },
                          { salesOrder: { orderNo: { contains: q.keyword, mode: 'insensitive' } } },
                          { salesOrder: { customer: { name: { contains: q.keyword, mode: 'insensitive' } } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.salesOrderTransportRequest.findMany({
                where,
                ...this.page(q),
                orderBy: [{ status: 'asc' }, { requestedAt: 'desc' }],
                include: {
                    actual: true,
                    salesOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            orderDate: true,
                            status: true,
                            customer: { select: { id: true, code: true, name: true } },
                            lines: {
                                where: { isTransportFeeApplicable: true },
                                orderBy: { lineNo: 'asc' },
                                select: {
                                    id: true,
                                    lineNo: true,
                                    orderedActualQty: true,
                                    transportFeeUnitPrice: true,
                                    product: { select: { id: true, code: true, name: true, uom: true } },
                                },
                            },
                        },
                    },
                },
            }),
            this.prisma.salesOrderTransportRequest.count({ where }),
        ])
        return {
            items: items.map((request) => ({
                ...request,
                tripNo: request.tripNo ?? `CX-${request.salesOrder.orderNo}`,
                ...this.transportFinancials(request),
                missingFields: this.transportMissingFields(request.actual),
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async salesTransportRequest(id: string) {
        const request = await this.prisma.salesOrderTransportRequest.findUniqueOrThrow({
            where: { id },
            include: {
                actual: true,
                salesOrder: {
                    include: {
                        customer: { select: { id: true, code: true, name: true } },
                        lines: {
                            orderBy: { lineNo: 'asc' },
                            include: { product: { select: { id: true, code: true, name: true, uom: true } } },
                        },
                    },
                },
            },
        })
        const suggestedSettings = await this.transportSettingFor(
            request.actual?.actualVehiclePlate ?? request.plannedVehiclePlate,
            request.actual?.actualTripDate ?? request.salesOrder.orderDate,
        )
        return {
            ...request,
            tripNo: request.tripNo ?? `CX-${request.salesOrder.orderNo}`,
            ...this.transportFinancials({
                ...request,
                salesOrder: { ...request.salesOrder, lines: request.salesOrder.lines.filter((line) => line.isTransportFeeApplicable) },
            }),
            missingFields: this.transportMissingFields(request.actual),
            suggestedSettings,
        }
    }

    async acknowledgeSalesTransportRequest(id: string) {
        const request = await this.prisma.salesOrderTransportRequest.findUnique({ where: { id } })
        if (!request) throw new NotFoundException('SALES_TRANSPORT_REQUEST_NOT_FOUND')
        if (request.status === SalesTransportRequestStatus.CANCELLED) {
            throw new BadRequestException('SALES_TRANSPORT_REQUEST_CANCELLED')
        }
        if (request.status === SalesTransportRequestStatus.ACKNOWLEDGED || request.status === SalesTransportRequestStatus.COMPLETED) return request
        return this.prisma.salesOrderTransportRequest.update({
            where: { id },
            data: { status: SalesTransportRequestStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
        })
    }

    async saveSalesTransportActual(id: string, dto: UpsertSalesTransportActualDto) {
        const request = await this.prisma.salesOrderTransportRequest.findUnique({
            where: { id },
            include: { salesOrder: { select: { orderDate: true } } },
        })
        if (!request) throw new NotFoundException('SALES_TRANSPORT_REQUEST_NOT_FOUND')
        if (request.status === SalesTransportRequestStatus.CANCELLED) {
            throw new BadRequestException('SALES_TRANSPORT_REQUEST_CANCELLED')
        }

        const settings = await this.transportSettingFor(
            dto.actualVehiclePlate ?? request.plannedVehiclePlate,
            dto.actualTripDate ? new Date(dto.actualTripDate) : request.salesOrder.orderDate,
        )
        const tripDistanceKm = new Prisma.Decimal(dto.tripDistanceKm ?? 0)
        const fuelConsumptionPer100 = new Prisma.Decimal(dto.fuelConsumptionPer100 ?? settings?.fuelConsumptionPer100 ?? 0)
        const fuelConsumedQty = tripDistanceKm.mul(fuelConsumptionPer100).div(100)
        const actualData = {
            actualVehiclePlate: dto.actualVehiclePlate?.trim() || null,
            actualDriverName: dto.actualDriverName?.trim() || null,
            actualTripDate: dto.actualTripDate ? new Date(dto.actualTripDate) : null,
            tripDistanceKm,
            fuelConsumptionPer100,
            fuelConsumedQty,
            fuelUnitPrice: new Prisma.Decimal(dto.fuelUnitPrice ?? settings?.fuelUnitPrice ?? 0),
            warehouseEntryFee: dto.warehouseEntryFee ?? 0,
            tollAndTerminalFee: dto.tollAndTerminalFee ?? 0,
            portDeliverySurcharge: dto.portDeliverySurcharge ?? 0,
            stationAgencyDutyFee: dto.stationAgencyDutyFee ?? 0,
            portTicketFee: dto.portTicketFee ?? 0,
            invoiceIssuanceFee: dto.invoiceIssuanceFee ?? 0,
            driverAllowance: dto.driverAllowance ?? settings?.defaultTripAllowance ?? 0,
            loadingUnloadingFee: dto.loadingUnloadingFee ?? 0,
            otherExpense: dto.otherExpense ?? 0,
            note: dto.note?.trim() || null,
        }
        const missingFields = this.transportMissingFields(actualData)
        if (dto.complete && missingFields.length) {
            throw new BadRequestException(`SALES_TRANSPORT_REQUEST_INCOMPLETE: ${missingFields.join(', ')}`)
        }

        await this.prisma.$transaction([
            this.prisma.salesOrderTransportActual.upsert({
                where: { transportRequestId: id },
                create: {
                    transportRequestId: id,
                    ...actualData,
                },
                update: actualData,
            }),
            ...(dto.complete
                ? [
                      this.prisma.salesOrderTransportRequest.update({
                          where: { id },
                          data: { status: SalesTransportRequestStatus.COMPLETED, completedAt: new Date() },
                      }),
                  ]
                : request.status === SalesTransportRequestStatus.NEW
                ? [
                      this.prisma.salesOrderTransportRequest.update({
                          where: { id },
                          data: { status: SalesTransportRequestStatus.ACKNOWLEDGED, acknowledgedAt: new Date() },
                      }),
                  ]
                : []),
        ])
        return this.salesTransportRequest(id)
    }

    async dispatch(id: string) {
        const row = await this.prisma.vehicleDispatchOrder.findUniqueOrThrow({
            where: { id },
            include: {
                vehicle: { include: { documents: true } },
                driver: { include: { documents: true } },
                product: true,
                fromSupplierLocation: true,
                toSupplierLocation: true,
                inventoryMovement: true,
            },
        })
        return {
            ...row,
            warehouseTransferId: row.inventoryMovementId,
            warehouseTransfer: row.inventoryMovement,
        }
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
            inventoryMovementId: dto.warehouseTransferId ?? null,
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
