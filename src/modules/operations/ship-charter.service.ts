import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    AvailabilityLedgerSourceType,
    ExpectedInventorySourceType,
    OperationalCostSourceType,
    OperationRegistrationStatus,
    Prisma,
    ShipCharterOrderSourceType,
    ShipCharterOrderStatus,
    TermLogisticsCostStatus,
    TermLogisticsCostType,
    WarehouseOwnerType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    CreateOperationalRoleDto,
    PageQueryDto,
    UpsertCharterInsuranceDto,
    UpsertCharterInspectionDto,
    UpsertShipCharterAppendixDto,
    UpsertShipCharterContractDto,
    UpsertShipCharterOrderDto,
    UpsertShipFreightRateDto,
    UpsertShippingAgentDto,
    UpsertVesselDto,
} from './dto/operations.dto'
import { WarehouseAvailabilityService } from './warehouse-availability.service'

@Injectable()
export class ShipCharterService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly availability: WarehouseAvailabilityService,
    ) {}

    private page(q: PageQueryDto) {
        return { skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 30), take: q.pageSize ?? 30 }
    }

    listPartners(role?: string, keyword?: string) {
        return this.prisma.customerOperationalRole.findMany({
            where: {
                isActive: true,
                ...(role ? { role: role as any } : {}),
                ...(keyword
                    ? {
                          customer: {
                              OR: [
                                  { name: { contains: keyword, mode: 'insensitive' } },
                                  { code: { contains: keyword, mode: 'insensitive' } },
                              ],
                          },
                      }
                    : {}),
            },
            include: { customer: true },
            orderBy: { customer: { name: 'asc' } },
        })
    }

    savePartnerRole(dto: CreateOperationalRoleDto) {
        return this.prisma.customerOperationalRole.upsert({
            where: { customerId_role: { customerId: dto.customerId, role: dto.role } },
            create: dto,
            update: { isActive: dto.isActive ?? true, note: dto.note },
            include: { customer: true },
        })
    }

    async listVessels(q: PageQueryDto & { ownerCustomerId?: string; isActive?: string }) {
        const where: Prisma.VesselWhereInput = {
            ...(q.ownerCustomerId ? { ownerCustomerId: q.ownerCustomerId } : {}),
            ...(q.isActive !== undefined ? { isActive: q.isActive === 'true' } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { name: { contains: q.keyword, mode: 'insensitive' } },
                          { imoNo: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vessel.findMany({
                where,
                ...this.page(q),
                include: { owner: { select: { id: true, code: true, name: true } } },
                orderBy: { name: 'asc' },
            }),
            this.prisma.vessel.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    vessel(id: string) {
        return this.prisma.vessel.findUniqueOrThrow({ where: { id }, include: { owner: true } })
    }

    saveVessel(dto: UpsertVesselDto, id?: string) {
        const data: Prisma.VesselUncheckedCreateInput = {
            name: dto.name.trim(),
            ownerCustomerId: dto.ownerCustomerId,
            imoNo: dto.imoNo?.trim() || null,
            nationality: dto.nationality?.trim() || null,
            deadweightTonnage: dto.deadweightTonnage,
            capacity: dto.capacity,
            length: dto.length,
            width: dto.width,
            draft: dto.draft,
            allowedCargoTypes: dto.allowedCargoTypes as Prisma.InputJsonValue,
            documentFileUrl: dto.documentFileUrl?.trim() || null,
            isActive: dto.isActive ?? true,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.vessel.update({ where: { id }, data, include: { owner: true } })
            : this.prisma.vessel.create({ data, include: { owner: true } })
    }

    async listContracts(q: PageQueryDto) {
        const where: Prisma.ShipCharterContractWhereInput = {
            ...(q.keyword
                ? {
                      OR: [
                          { contractNo: { contains: q.keyword, mode: 'insensitive' } },
                          { owner: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterContract.findMany({
                where,
                ...this.page(q),
                include: { owner: true, _count: { select: { appendices: true } } },
                orderBy: { signedDate: 'desc' },
            }),
            this.prisma.shipCharterContract.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    contract(id: string) {
        return this.prisma.shipCharterContract.findUniqueOrThrow({
            where: { id },
            include: { owner: true, appendices: { include: { vessel: true }, orderBy: { appendixDate: 'desc' } } },
        })
    }

    saveContract(dto: UpsertShipCharterContractDto, id?: string) {
        const data = {
            contractNo: dto.contractNo.trim(),
            ownerCustomerId: dto.ownerCustomerId,
            signedDate: new Date(dto.signedDate),
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterContract.update({ where: { id }, data, include: { owner: true } })
            : this.prisma.shipCharterContract.create({ data, include: { owner: true } })
    }

    async listAppendices(q: PageQueryDto & { contractId?: string }) {
        const where: Prisma.ShipCharterAppendixWhereInput = {
            ...(q.contractId ? { contractId: q.contractId } : {}),
            ...(q.keyword ? { appendixNo: { contains: q.keyword, mode: 'insensitive' } } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterAppendix.findMany({
                where,
                ...this.page(q),
                include: { contract: { include: { owner: true } }, vessel: true },
                orderBy: { appendixDate: 'desc' },
            }),
            this.prisma.shipCharterAppendix.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveAppendix(dto: UpsertShipCharterAppendixDto, id?: string) {
        const data = {
            contractId: dto.contractId,
            appendixNo: dto.appendixNo.trim(),
            appendixDate: new Date(dto.appendixDate),
            vesselId: dto.vesselId ?? null,
            cargoName: dto.cargoName?.trim() || null,
            plannedQty: dto.plannedQty,
            qtyTolerancePercent: dto.qtyTolerancePercent,
            loadingPort: dto.loadingPort?.trim() || null,
            dischargePort: dto.dischargePort?.trim() || null,
            laycanFrom: dto.laycanFrom ? new Date(dto.laycanFrom) : null,
            laycanTo: dto.laycanTo ? new Date(dto.laycanTo) : null,
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            lossRatePercent: dto.lossRatePercent,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterAppendix.update({ where: { id }, data })
            : this.prisma.shipCharterAppendix.create({ data })
    }

    async listOrders(q: PageQueryDto & { purchaseOrderId?: string }) {
        const where: Prisma.ShipCharterOrderWhereInput = {
            ...(q.status ? { status: q.status as ShipCharterOrderStatus } : {}),
            ...(q.purchaseOrderId ? { purchaseOrderId: q.purchaseOrderId } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { charterOrderNo: { contains: q.keyword, mode: 'insensitive' } },
                          { cargoName: { contains: q.keyword, mode: 'insensitive' } },
                          { purchaseOrder: { orderNo: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterOrder.findMany({
                where,
                ...this.page(q),
                orderBy: [{ laycanFrom: 'asc' }, { createdAt: 'desc' }],
                include: {
                    purchaseOrder: { select: { id: true, orderNo: true } },
                    owner: { select: { id: true, code: true, name: true } },
                    vessel: true,
                    _count: { select: { insurances: true, inspections: true, agentRegistrations: true } },
                },
            }),
            this.prisma.shipCharterOrder.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    order(id: string) {
        return this.prisma.shipCharterOrder.findUniqueOrThrow({
            where: { id },
            include: {
                purchaseOrder: { include: { lines: { include: { product: true } }, supplierLocation: true } },
                termShipment: true,
                appendix: { include: { contract: true } },
                owner: true,
                vessel: true,
                insurances: { include: { insuranceCompany: true }, orderBy: { createdAt: 'desc' } },
                inspections: { include: { inspectionCompany: true }, orderBy: { createdAt: 'desc' } },
                agentRegistrations: { include: { agent: true }, orderBy: { createdAt: 'desc' } },
            },
        })
    }

    saveOrder(dto: UpsertShipCharterOrderDto, id?: string) {
        const data = {
            charterOrderNo: dto.charterOrderNo.trim(),
            sourceType: dto.sourceType ?? ShipCharterOrderSourceType.DIRECT,
            purchaseOrderId: dto.purchaseOrderId ?? null,
            termShipmentId: dto.termShipmentId ?? null,
            appendixId: dto.appendixId ?? null,
            ownerCustomerId: dto.ownerCustomerId,
            vesselId: dto.vesselId ?? null,
            laycanFrom: dto.laycanFrom ? new Date(dto.laycanFrom) : null,
            laycanTo: dto.laycanTo ? new Date(dto.laycanTo) : null,
            cargoName: dto.cargoName?.trim() || null,
            plannedQty: dto.plannedQty,
            loadingPort: dto.loadingPort?.trim() || null,
            dischargePort: dto.dischargePort?.trim() || null,
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            lossRatePercent: dto.lossRatePercent,
            status: dto.status ?? ShipCharterOrderStatus.DRAFT,
            appendixFileUrl: dto.appendixFileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterOrder.update({ where: { id }, data })
            : this.prisma.shipCharterOrder.create({ data })
    }

    async changeOrderStatus(id: string, status: ShipCharterOrderStatus) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.shipCharterOrder.findUnique({
                where: { id },
                include: { purchaseOrder: { include: { lines: true } } },
            })
            if (!row) throw new NotFoundException('Charter order not found')
            if (
                status === ShipCharterOrderStatus.CONFIRMED &&
                (!row.ownerCustomerId ||
                    !row.cargoName ||
                    !row.loadingPort ||
                    !row.dischargePort ||
                    new Prisma.Decimal(row.plannedQty).lessThanOrEqualTo(0))
            ) {
                throw new BadRequestException(
                    'Charter order requires owner, cargo, quantity, loading port and discharge port before confirmation',
                )
            }
            const allowed: Record<ShipCharterOrderStatus, ShipCharterOrderStatus[]> = {
                DRAFT: [ShipCharterOrderStatus.WAITING_CONFIRMATION, ShipCharterOrderStatus.CONFIRMED, ShipCharterOrderStatus.CANCELLED],
                WAITING_CONFIRMATION: [ShipCharterOrderStatus.CONFIRMED, ShipCharterOrderStatus.CANCELLED],
                CONFIRMED: [ShipCharterOrderStatus.IN_PROGRESS, ShipCharterOrderStatus.CANCELLED],
                IN_PROGRESS: [ShipCharterOrderStatus.COMPLETED, ShipCharterOrderStatus.CANCELLED],
                COMPLETED: [],
                CANCELLED: [],
            }
            if (!allowed[row.status].includes(status)) throw new BadRequestException(`Invalid transition ${row.status} -> ${status}`)

            if (status === ShipCharterOrderStatus.CONFIRMED && row.purchaseOrder?.supplierLocationId) {
                const ownerKey = this.availability.ownerKey(WarehouseOwnerType.INTERNAL)
                for (const line of row.purchaseOrder.lines) {
                    const expected = await tx.expectedInventory.upsert({
                        where: {
                            sourceType_sourceId_supplierLocationId_productId_ownerKey: {
                                sourceType: ExpectedInventorySourceType.SHIP_CHARTER_ORDER,
                                sourceId: row.id,
                                supplierLocationId: line.supplierLocationId ?? row.purchaseOrder.supplierLocationId,
                                productId: line.productId,
                                ownerKey,
                            },
                        },
                        create: {
                            sourceType: ExpectedInventorySourceType.SHIP_CHARTER_ORDER,
                            sourceId: row.id,
                            supplierLocationId: line.supplierLocationId ?? row.purchaseOrder.supplierLocationId,
                            productId: line.productId,
                            ownerType: WarehouseOwnerType.INTERNAL,
                            ownerKey,
                            expectedQty: line.orderedQty,
                            expectedDate: row.laycanTo,
                        },
                        update: {},
                    })
                    await this.availability.applyDelta({
                        tx,
                        supplierLocationId: expected.supplierLocationId,
                        productId: expected.productId,
                        ownerType: expected.ownerType,
                        delta: { expectedQty: expected.expectedQty },
                        sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                        sourceId: expected.id,
                        sourceAction: 'CREATE',
                    })
                }
            }
            return tx.shipCharterOrder.update({ where: { id }, data: { status } })
        })
    }

    saveInsurance(orderId: string, dto: UpsertCharterInsuranceDto, id?: string) {
        const data = {
            charterOrderId: orderId,
            insuranceCompanyId: dto.insuranceCompanyId,
            policyNo: dto.policyNo?.trim() || null,
            policyDate: dto.policyDate ? new Date(dto.policyDate) : null,
            insuredValue: dto.insuredValue,
            premiumAmount: dto.premiumAmount,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterInsurance.update({ where: { id }, data })
            : this.prisma.shipCharterInsurance.create({ data })
    }

    saveInspection(orderId: string, dto: UpsertCharterInspectionDto, id?: string) {
        const data = {
            charterOrderId: orderId,
            inspectionCompanyId: dto.inspectionCompanyId,
            inspectionType: dto.inspectionType,
            registeredDate: dto.registeredDate ? new Date(dto.registeredDate) : null,
            plannedInspectionDate: dto.plannedInspectionDate ? new Date(dto.plannedInspectionDate) : null,
            certificateNo: dto.certificateNo?.trim() || null,
            feeAmount: dto.feeAmount ?? 0,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterInspection.update({ where: { id }, data })
            : this.prisma.shipCharterInspection.create({ data })
    }

    saveAgent(orderId: string, dto: UpsertShippingAgentDto, id?: string) {
        const data = {
            charterOrderId: orderId,
            agentCustomerId: dto.agentCustomerId,
            registeredDate: dto.registeredDate ? new Date(dto.registeredDate) : null,
            agencyFee: dto.agencyFee,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shippingAgentRegistration.update({ where: { id }, data })
            : this.prisma.shippingAgentRegistration.create({ data })
    }

    async listFreightRates(q: PageQueryDto) {
        const where: Prisma.ShipFreightRateWhereInput = q.keyword
            ? {
                  OR: [
                      { loadingPort: { contains: q.keyword, mode: 'insensitive' } },
                      { dischargePort: { contains: q.keyword, mode: 'insensitive' } },
                      { productGroup: { contains: q.keyword, mode: 'insensitive' } },
                  ],
              }
            : {}
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipFreightRate.findMany({
                where,
                ...this.page(q),
                include: { owner: true, vessel: true },
                orderBy: { effectiveFrom: 'desc' },
            }),
            this.prisma.shipFreightRate.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveFreightRate(dto: UpsertShipFreightRateDto, id?: string) {
        const data = {
            ownerCustomerId: dto.ownerCustomerId ?? null,
            vesselId: dto.vesselId ?? null,
            loadingPort: dto.loadingPort.trim(),
            dischargePort: dto.dischargePort.trim(),
            productGroup: dto.productGroup?.trim() || null,
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipFreightRate.update({ where: { id }, data })
            : this.prisma.shipFreightRate.create({ data })
    }

    async postCostsToTerm(orderId: string) {
        const order = await this.order(orderId)
        if (!order.purchaseOrderId) throw new BadRequestException('Charter order is not linked to a TERM purchase order')
        const sources: Array<{
            sourceType: OperationalCostSourceType
            sourceId: string
            type: TermLogisticsCostType
            amount: Prisma.Decimal
            vendorCustomerId?: string | null
            documentNo?: string | null
        }> = []
        if (order.freightRateVndPerLiter) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_FREIGHT,
                sourceId: order.id,
                type: TermLogisticsCostType.FREIGHT,
                amount: new Prisma.Decimal(order.freightRateVndPerLiter).mul(order.plannedQty),
                vendorCustomerId: order.ownerCustomerId,
                documentNo: order.charterOrderNo,
            })
        }
        for (const x of order.insurances.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_INSURANCE,
                sourceId: x.id,
                type: TermLogisticsCostType.INSURANCE,
                amount: new Prisma.Decimal(x.premiumAmount),
                vendorCustomerId: x.insuranceCompanyId,
                documentNo: x.policyNo,
            })
        }
        for (const x of order.inspections.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_INSPECTION,
                sourceId: x.id,
                type: TermLogisticsCostType.INSPECTION,
                amount: new Prisma.Decimal(x.feeAmount),
                vendorCustomerId: x.inspectionCompanyId,
                documentNo: x.certificateNo,
            })
        }
        for (const x of order.agentRegistrations.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIPPING_AGENT,
                sourceId: x.id,
                type: TermLogisticsCostType.HANDLING,
                amount: new Prisma.Decimal(x.agencyFee),
                vendorCustomerId: x.agentCustomerId,
            })
        }

        return this.prisma.$transaction(async (tx) => {
            const posted: string[] = []
            for (const source of sources.filter((x) => x.amount.greaterThan(0))) {
                const existing = await tx.termLogisticsCostLine.findUnique({
                    where: {
                        operationsSourceType_operationsSourceId: {
                            operationsSourceType: source.sourceType,
                            operationsSourceId: source.sourceId,
                        },
                    },
                })
                if (existing) {
                    posted.push(existing.id)
                    continue
                }
                const header = await tx.termLogisticsCost.create({
                    data: {
                        purchaseOrderId: order.purchaseOrderId!,
                        shipmentId: order.termShipmentId,
                        vendorCustomerId: source.vendorCustomerId,
                        documentNo: source.documentNo,
                        documentDate: new Date(),
                        totalBeforeVat: source.amount,
                        totalAfterVat: source.amount,
                        status: TermLogisticsCostStatus.CONFIRMED,
                        note: `Posted from operations charter ${order.charterOrderNo}`,
                    },
                })
                const line = await tx.termLogisticsCostLine.create({
                    data: {
                        logisticsCostId: header.id,
                        costType: source.type,
                        amountBeforeVat: source.amount,
                        amountAfterVat: source.amount,
                        amountVndBeforeVat: source.amount,
                        operationsSourceType: source.sourceType,
                        operationsSourceId: source.sourceId,
                        note: `Operations source ${source.sourceType}`,
                    },
                })
                posted.push(line.id)
            }
            return { postedCount: posted.length, lineIds: posted }
        })
    }
}
