import { Injectable } from '@nestjs/common'
import {
    ReconciliationVarianceStatus,
    ExpectedSupplyStatus,
    InventoryDocumentStatus,
    InventoryMovementStatus,
    OperationRegistrationStatus,
    Prisma,
    ShipCharterOrderStatus,
    VehicleDispatchStatus,
    VehicleDocumentType,
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
            dispatched,
            arrived,
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
            this.prisma.inventoryAvailabilityBalance.aggregate({
                _sum: {
                    onHandActualQty: true,
                    reservedActualQty: true,
                    pendingActualQty: true,
                    blockedActualQty: true,
                },
            }),
            this.prisma.inventoryDispatchLine.aggregate({
                where: { dispatch: { status: InventoryDocumentStatus.POSTED } },
                _sum: { actualQty: true },
            }),
            this.prisma.inventoryArrivalLine.aggregate({
                where: { arrival: { status: InventoryDocumentStatus.POSTED } },
                _sum: { actualQty: true },
            }),
            this.prisma.inventoryMovement.count({
                where: {
                    status: {
                        in: [InventoryMovementStatus.IN_TRANSIT, InventoryMovementStatus.PARTIALLY_ARRIVED],
                    },
                },
            }),
            this.prisma.reconciliationVariance.count({
                where: {
                    status: {
                        in: [
                            ReconciliationVarianceStatus.OPEN,
                            ReconciliationVarianceStatus.EXPLAINED,
                        ],
                    },
                    varianceActualQty: { not: 0 },
                },
            }),
            this.prisma.expectedSupply.count({
                where: {
                    status: { in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED] },
                    expectedAt: { gte: todayStart, lte: warningDate },
                },
            }),
        ])

        const physical = new Prisma.Decimal(availability._sum.onHandActualQty ?? 0)
        const reserved = new Prisma.Decimal(availability._sum.reservedActualQty ?? 0)
        const pending = new Prisma.Decimal(availability._sum.pendingActualQty ?? 0)
        const blocked = new Prisma.Decimal(availability._sum.blockedActualQty ?? 0)
        const sellable = physical.minus(reserved).minus(pending).minus(blocked)
        const inTransit = new Prisma.Decimal(dispatched._sum.actualQty ?? 0).minus(arrived._sum.actualQty ?? 0)
        const expected = await this.prisma.expectedSupply.aggregate({
            where: { status: { in: [ExpectedSupplyStatus.OPEN, ExpectedSupplyStatus.PARTIALLY_FULFILLED] } },
            _sum: { expectedActualQty: true, fulfilledActualQty: true },
        })
        const expectedQty = new Prisma.Decimal(expected._sum.expectedActualQty ?? 0).minus(
            expected._sum.fulfilledActualQty ?? 0,
        )

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
                availableQty: physical.minus(pending).minus(blocked),
                reservedQty: reserved,
                sellableQty: sellable,
                inTransitQty: inTransit,
                expectedQty,
                physicalQty: physical,
                pendingDocQty: pending,
                postedQty: physical.minus(pending),
                blockedQty: blocked,
                transfersInTransit,
                reconciliationVariance,
                expectedSoon,
            },
        }
    }
}
