import { Injectable } from '@nestjs/common'
import {
    ExpectedInventoryStatus,
    OperationRegistrationStatus,
    Prisma,
    ShipCharterOrderStatus,
    VehicleDispatchStatus,
    VehicleDocumentType,
    WarehouseTransferStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class OperationsDashboardService {
    constructor(private readonly prisma: PrismaService) {}

    async get() {
        const now = new Date()
        const todayStart = new Date(now)
        todayStart.setHours(0, 0, 0, 0)
        const todayEnd = new Date(todayStart)
        todayEnd.setDate(todayEnd.getDate() + 1)
        const warningDate = new Date(now)
        warningDate.setDate(warningDate.getDate() + 30)

        const activeDispatchStatuses = [
            VehicleDispatchStatus.ASSIGNED,
            VehicleDispatchStatus.LOADING,
            VehicleDispatchStatus.IN_TRANSIT,
        ]

        const [
            termCharterNew,
            waitingCharters,
            laycanSoon,
            missingInsurance,
            missingInspection,
            missingAgent,
            missingAppendixFiles,
            todayTrips,
            runningTrips,
            waitingLoading,
            waitingDelivery,
            delayedTrips,
            activeVehicles,
            occupiedVehicles,
            expiringInspections,
            expiringVehicleInsurance,
            expiringLicenses,
            availability,
            accounting,
            transfersInTransit,
            reconciliationVariance,
            expectedSoon,
        ] = await Promise.all([
            this.prisma.shipCharterOrder.count({
                where: { sourceType: 'FROM_TERM', createdAt: { gte: todayStart } },
            }),
            this.prisma.shipCharterOrder.count({ where: { status: ShipCharterOrderStatus.WAITING_CONFIRMATION } }),
            this.prisma.shipCharterOrder.count({
                where: {
                    status: { notIn: [ShipCharterOrderStatus.COMPLETED, ShipCharterOrderStatus.CANCELLED] },
                    laycanFrom: { gte: now, lte: warningDate },
                },
            }),
            this.prisma.shipCharterOrder.count({
                where: {
                    status: { not: ShipCharterOrderStatus.CANCELLED },
                    insurances: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } },
                },
            }),
            this.prisma.shipCharterOrder.count({
                where: {
                    status: { not: ShipCharterOrderStatus.CANCELLED },
                    inspections: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } },
                },
            }),
            this.prisma.shipCharterOrder.count({
                where: {
                    status: { not: ShipCharterOrderStatus.CANCELLED },
                    agentRegistrations: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } },
                },
            }),
            this.prisma.shipCharterAppendix.count({ where: { OR: [{ fileUrl: null }, { fileUrl: '' }] } }),
            this.prisma.vehicleDispatchOrder.count({
                where: { plannedStartAt: { gte: todayStart, lt: todayEnd }, status: { not: VehicleDispatchStatus.CANCELLED } },
            }),
            this.prisma.vehicleDispatchOrder.count({ where: { status: VehicleDispatchStatus.IN_TRANSIT } }),
            this.prisma.vehicleDispatchOrder.count({ where: { status: VehicleDispatchStatus.LOADING } }),
            this.prisma.vehicleDispatchOrder.count({ where: { status: VehicleDispatchStatus.DELIVERED } }),
            this.prisma.vehicleDispatchOrder.count({
                where: {
                    plannedStartAt: { lt: now },
                    actualStartAt: null,
                    status: { in: [VehicleDispatchStatus.DRAFT, VehicleDispatchStatus.ASSIGNED] },
                },
            }),
            this.prisma.vehicle.count({ where: { isActive: true } }),
            this.prisma.vehicleDispatchOrder.findMany({
                where: { status: { in: activeDispatchStatuses } },
                distinct: ['vehicleId'],
                select: { vehicleId: true },
            }),
            this.prisma.vehicleDocument.count({
                where: { documentType: VehicleDocumentType.INSPECTION, expiredDate: { gte: now, lte: warningDate } },
            }),
            this.prisma.vehicleDocument.count({
                where: { documentType: VehicleDocumentType.INSURANCE, expiredDate: { gte: now, lte: warningDate } },
            }),
            this.prisma.driverDocument.count({
                where: { documentType: 'DRIVER_LICENSE', expiredDate: { gte: now, lte: warningDate } },
            }),
            this.prisma.warehouseAvailabilityBalance.aggregate({
                _sum: { availableQty: true, reservedQty: true, inTransitQty: true, expectedQty: true },
            }),
            this.prisma.inventoryBalance.aggregate({
                _sum: { physicalQty: true, pendingDocQty: true, postedQty: true },
            }),
            this.prisma.warehouseTransfer.count({
                where: { status: { in: [WarehouseTransferStatus.CONFIRMED, WarehouseTransferStatus.IN_TRANSIT] } },
            }),
            this.prisma.reconcileVariance.count({ where: { resolvedAt: null, varianceQty: { not: 0 } } }),
            this.prisma.expectedInventory.count({
                where: {
                    status: { in: [ExpectedInventoryStatus.OPEN, ExpectedInventoryStatus.PARTIALLY_RECEIVED] },
                    expectedDate: { gte: todayStart, lte: warningDate },
                },
            }),
        ])

        const available = new Prisma.Decimal(availability._sum.availableQty ?? 0)
        const reserved = new Prisma.Decimal(availability._sum.reservedQty ?? 0)

        return {
            shipCharter: {
                termCharterNew,
                waitingCharters,
                laycanSoon,
                missingInsurance,
                missingInspection,
                missingAgent,
                missingAppendixFiles,
            },
            roadTransport: {
                todayTrips,
                runningTrips,
                idleVehicles: Math.max(0, activeVehicles - occupiedVehicles.length),
                waitingLoading,
                waitingDelivery,
                delayedTrips,
                expiringInspections,
                expiringVehicleInsurance,
                expiringLicenses,
            },
            warehouse: {
                availableQty: available,
                reservedQty: reserved,
                sellableQty: available.minus(reserved),
                inTransitQty: availability._sum.inTransitQty ?? new Prisma.Decimal(0),
                expectedQty: availability._sum.expectedQty ?? new Prisma.Decimal(0),
                physicalQty: accounting._sum.physicalQty ?? new Prisma.Decimal(0),
                pendingDocQty: accounting._sum.pendingDocQty ?? new Prisma.Decimal(0),
                postedQty: accounting._sum.postedQty ?? new Prisma.Decimal(0),
                transfersInTransit,
                reconciliationVariance,
                expectedSoon,
            },
        }
    }
}
