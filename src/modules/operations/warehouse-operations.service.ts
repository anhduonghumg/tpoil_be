import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    AvailabilityLedgerSourceType,
    ExpectedInventoryStatus,
    InventoryLedgerSourceType,
    Prisma,
    WarehouseOwnerType,
    WarehouseReservationStatus,
    WarehouseTransferStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryService } from 'src/modules/inventory/inventory.service'
import {
    AllocateExpectedInventoryDto,
    CreateExpectedInventoryDto,
    CreateWarehouseReservationDto,
    PageQueryDto,
    UpsertStorageRentalContractDto,
    UpsertWarehouseTransferDto,
    PostStorageTermCostDto,
} from './dto/operations.dto'
import { WarehouseAvailabilityService } from './warehouse-availability.service'

@Injectable()
export class WarehouseOperationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly availability: WarehouseAvailabilityService,
        private readonly inventory: InventoryService,
    ) {}

    private page(q: PageQueryDto) {
        return {
            skip: ((q.page ?? 1) - 1) * (q.pageSize ?? 30),
            take: q.pageSize ?? 30,
        }
    }

    async listStorageContracts(q: PageQueryDto) {
        const keyword = q.keyword?.trim()
        const where: Prisma.StorageRentalContractWhereInput = {
            ...(q.status ? { status: q.status as any } : {}),
            ...(keyword
                ? {
                      OR: [
                          { contractNo: { contains: keyword, mode: 'insensitive' } },
                          { lessor: { name: { contains: keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.storageRentalContract.findMany({
                where,
                ...this.page(q),
                orderBy: { createdAt: 'desc' },
                include: {
                    lessor: { select: { id: true, code: true, name: true } },
                    locations: { include: { supplierLocation: true } },
                    lossRates: true,
                    feeTiers: { orderBy: { sortOrder: 'asc' } },
                },
            }),
            this.prisma.storageRentalContract.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    storageContract(id: string) {
        return this.prisma.storageRentalContract.findUniqueOrThrow({
            where: { id },
            include: {
                lessor: true,
                locations: { include: { supplierLocation: true } },
                lossRates: true,
                feeTiers: { orderBy: { sortOrder: 'asc' } },
            },
        })
    }

    async saveStorageContract(dto: UpsertStorageRentalContractDto, id?: string) {
        const data = {
            contractNo: dto.contractNo.trim(),
            lessorCustomerId: dto.lessorCustomerId,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            currency: dto.currency?.trim() || 'VND',
            status: dto.status,
            fileName: dto.fileName?.trim() || null,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        const rowId = await this.prisma.$transaction(async (tx) => {
            const row = id
                ? await tx.storageRentalContract.update({ where: { id }, data })
                : await tx.storageRentalContract.create({ data })
            await tx.storageRentalContractLocation.deleteMany({ where: { contractId: row.id } })
            await tx.storageRentalLossRate.deleteMany({ where: { contractId: row.id } })
            await tx.storageRentalFeeTier.deleteMany({ where: { contractId: row.id } })
            if (dto.supplierLocationIds.length) {
                await tx.storageRentalContractLocation.createMany({
                    data: [...new Set(dto.supplierLocationIds)].map((supplierLocationId) => ({
                        contractId: row.id,
                        supplierLocationId,
                    })),
                })
            }
            if (dto.lossRates?.length) {
                await tx.storageRentalLossRate.createMany({
                    data: dto.lossRates.map((x) => ({ ...x, contractId: row.id })),
                })
            }
            if (dto.feeTiers?.length) {
                await tx.storageRentalFeeTier.createMany({
                    data: dto.feeTiers.map((x, index) => ({
                        ...x,
                        unit: x.unit || 'VND/LITER',
                        sortOrder: x.sortOrder ?? index,
                        contractId: row.id,
                    })),
                })
            }
            return row.id
        })
        return this.storageContract(rowId)
    }

    async postStorageTermCost(contractId: string, dto: PostStorageTermCostDto) {
        const contract = await this.prisma.storageRentalContract.findUnique({ where: { id: contractId } })
        if (!contract) throw new NotFoundException('Storage rental contract not found')
        const sourceType = dto.costType === 'LOSS' ? 'STORAGE_LOSS' : 'STORAGE_RENTAL'
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.termLogisticsCostLine.findUnique({
                where: {
                    operationsSourceType_operationsSourceId: {
                        operationsSourceType: sourceType,
                        operationsSourceId: dto.purchaseOrderId,
                    },
                },
            })
            if (existing) return existing
            const amount = new Prisma.Decimal(dto.amountVnd)
            const header = await tx.termLogisticsCost.create({
                data: {
                    purchaseOrderId: dto.purchaseOrderId,
                    vendorCustomerId: contract.lessorCustomerId,
                    documentNo: dto.documentNo?.trim() || contract.contractNo,
                    documentDate: dto.documentDate ? new Date(dto.documentDate) : new Date(),
                    totalBeforeVat: amount,
                    totalAfterVat: amount,
                    status: 'CONFIRMED',
                    note: dto.note?.trim() || `Chi phí từ hợp đồng thuê kho ${contract.contractNo}`,
                },
            })
            return tx.termLogisticsCostLine.create({
                data: {
                    logisticsCostId: header.id,
                    costType: dto.costType,
                    amountBeforeVat: amount,
                    amountAfterVat: amount,
                    amountVndBeforeVat: amount,
                    operationsSourceType: sourceType,
                    operationsSourceId: dto.purchaseOrderId,
                    note: `Storage contract ${contract.contractNo}`,
                },
            })
        })
    }

    async listAvailability(q: PageQueryDto & { supplierLocationId?: string; productId?: string; ownerType?: WarehouseOwnerType }) {
        const where: Prisma.WarehouseAvailabilityBalanceWhereInput = {
            ...(q.supplierLocationId ? { supplierLocationId: q.supplierLocationId } : {}),
            ...(q.productId ? { productId: q.productId } : {}),
            ...(q.ownerType ? { ownerType: q.ownerType } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.warehouseAvailabilityBalance.findMany({
                where,
                ...this.page(q),
                orderBy: [{ supplierLocation: { name: 'asc' } }, { product: { name: 'asc' } }],
                include: {
                    supplierLocation: { select: { id: true, code: true, name: true } },
                    product: { select: { id: true, code: true, name: true, uom: true } },
                    ownerCustomer: { select: { id: true, code: true, name: true } },
                },
            }),
            this.prisma.warehouseAvailabilityBalance.count({ where }),
        ])
        return {
            items: items.map((x) => ({
                ...x,
                sellableQty: new Prisma.Decimal(x.availableQty).minus(x.reservedQty),
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async inventoryMatrix(q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
        const availability = await this.listAvailability(q)
        const accounting = await this.prisma.inventoryBalance.findMany({
            where: {
                ...(q.supplierLocationId ? { supplierLocationId: q.supplierLocationId } : {}),
                ...(q.productId ? { productId: q.productId } : {}),
            },
            include: {
                supplierLocation: { select: { id: true, code: true, name: true } },
                product: { select: { id: true, code: true, name: true, uom: true } },
            },
            orderBy: [{ supplierLocation: { name: 'asc' } }, { product: { name: 'asc' } }],
        })
        return { availability, accounting }
    }

    async createExpected(dto: CreateExpectedInventoryDto) {
        const ownerKey = this.availability.ownerKey(dto.ownerType, dto.ownerCustomerId)
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.expectedInventory.create({
                data: {
                    sourceType: dto.sourceType,
                    sourceId: dto.sourceId,
                    supplierLocationId: dto.supplierLocationId,
                    productId: dto.productId,
                    ownerType: dto.ownerType,
                    ownerKey,
                    ownerCustomerId: dto.ownerCustomerId ?? null,
                    expectedQty: dto.expectedQty,
                    expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : null,
                    note: dto.note?.trim() || null,
                },
            })
            await this.availability.applyDelta({
                tx,
                supplierLocationId: row.supplierLocationId,
                productId: row.productId,
                ownerType: row.ownerType,
                ownerCustomerId: row.ownerCustomerId,
                delta: { expectedQty: row.expectedQty },
                sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                sourceId: row.id,
                sourceAction: 'CREATE',
            })
            return row
        })
    }

    async listExpected(q: PageQueryDto) {
        const where: Prisma.ExpectedInventoryWhereInput = {
            ...(q.status ? { status: q.status as ExpectedInventoryStatus } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.expectedInventory.findMany({
                where,
                ...this.page(q),
                orderBy: [{ expectedDate: 'asc' }, { createdAt: 'desc' }],
                include: { supplierLocation: true, product: true, ownerCustomer: true },
            }),
            this.prisma.expectedInventory.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    async allocateExpected(id: string, dto: AllocateExpectedInventoryDto) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.expectedInventory.findUnique({ where: { id } })
            if (!row) throw new NotFoundException('Expected inventory not found')
            if (row.status !== ExpectedInventoryStatus.OPEN && row.status !== ExpectedInventoryStatus.PARTIALLY_RECEIVED) {
                throw new BadRequestException('Expected inventory is not open')
            }
            const existing = await tx.expectedInventoryReceiptAllocation.findUnique({
                where: {
                    expectedInventoryId_goodsReceiptId: {
                        expectedInventoryId: id,
                        goodsReceiptId: dto.goodsReceiptId,
                    },
                },
            })
            if (existing) return existing
            const remaining = new Prisma.Decimal(row.expectedQty).minus(row.receivedQty)
            const allocated = new Prisma.Decimal(dto.allocatedQty)
            if (allocated.greaterThan(remaining)) throw new BadRequestException('Allocated quantity exceeds expected remainder')
            const newReceived = new Prisma.Decimal(row.receivedQty).plus(allocated)
            const status = newReceived.equals(row.expectedQty)
                ? ExpectedInventoryStatus.RECEIVED
                : ExpectedInventoryStatus.PARTIALLY_RECEIVED
            const allocation = await tx.expectedInventoryReceiptAllocation.create({
                data: { expectedInventoryId: id, goodsReceiptId: dto.goodsReceiptId, allocatedQty: allocated },
            })
            await tx.expectedInventory.update({ where: { id }, data: { receivedQty: newReceived, status } })
            await this.availability.applyDelta({
                tx,
                supplierLocationId: row.supplierLocationId,
                productId: row.productId,
                ownerType: row.ownerType,
                ownerCustomerId: row.ownerCustomerId,
                delta: { expectedQty: allocated.negated() },
                sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                sourceId: row.id,
                sourceAction: `RECEIPT:${dto.goodsReceiptId}`,
            })
            return allocation
        })
    }

    async cancelExpected(id: string) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.expectedInventory.findUnique({ where: { id } })
            if (!row) throw new NotFoundException('Expected inventory not found')
            if (row.status === ExpectedInventoryStatus.CANCELLED) return row
            if (row.status === ExpectedInventoryStatus.RECEIVED) throw new BadRequestException('Received expectation cannot be cancelled')
            const remainder = new Prisma.Decimal(row.expectedQty).minus(row.receivedQty)
            await this.availability.applyDelta({
                tx,
                supplierLocationId: row.supplierLocationId,
                productId: row.productId,
                ownerType: row.ownerType,
                ownerCustomerId: row.ownerCustomerId,
                delta: { expectedQty: remainder.negated() },
                sourceType: AvailabilityLedgerSourceType.EXPECTED_INVENTORY,
                sourceId: row.id,
                sourceAction: 'CANCEL',
            })
            return tx.expectedInventory.update({ where: { id }, data: { status: ExpectedInventoryStatus.CANCELLED } })
        })
    }

    async listReservations(q: PageQueryDto) {
        const where: Prisma.WarehouseReservationWhereInput = {
            ...(q.status ? { status: q.status as WarehouseReservationStatus } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { reservationNo: { contains: q.keyword, mode: 'insensitive' } },
                          { customer: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.warehouseReservation.findMany({
                where,
                ...this.page(q),
                orderBy: { reservedAt: 'desc' },
                include: { supplierLocation: true, product: true, customer: true },
            }),
            this.prisma.warehouseReservation.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    createReservation(dto: CreateWarehouseReservationDto) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.warehouseReservation.create({
                data: {
                    reservationNo: dto.reservationNo.trim(),
                    supplierLocationId: dto.supplierLocationId,
                    productId: dto.productId,
                    customerId: dto.customerId ?? null,
                    sourceType: dto.sourceType,
                    sourceId: dto.sourceId ?? null,
                    reservedQty: dto.reservedQty,
                    reservedAt: dto.reservedAt ? new Date(dto.reservedAt) : new Date(),
                    expiredAt: dto.expiredAt ? new Date(dto.expiredAt) : null,
                    note: dto.note?.trim() || null,
                },
            })
            await this.availability.applyDelta({
                tx,
                supplierLocationId: row.supplierLocationId,
                productId: row.productId,
                ownerType: WarehouseOwnerType.INTERNAL,
                delta: { reservedQty: row.reservedQty },
                sourceType: AvailabilityLedgerSourceType.RESERVATION,
                sourceId: row.id,
                sourceAction: 'ACTIVATE',
            })
            return row
        })
    }

    async changeReservation(id: string, status: WarehouseReservationStatus) {
        if (
            status !== WarehouseReservationStatus.RELEASED &&
            status !== WarehouseReservationStatus.CONSUMED &&
            status !== WarehouseReservationStatus.CANCELLED
        ) {
            throw new BadRequestException('Unsupported reservation transition')
        }
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.warehouseReservation.findUnique({ where: { id } })
            if (!row) throw new NotFoundException('Reservation not found')
            if (row.status === status) return row
            if (row.status !== WarehouseReservationStatus.ACTIVE) throw new BadRequestException('Reservation is not active')
            await this.availability.applyDelta({
                tx,
                supplierLocationId: row.supplierLocationId,
                productId: row.productId,
                ownerType: WarehouseOwnerType.INTERNAL,
                delta: { reservedQty: new Prisma.Decimal(row.reservedQty).negated() },
                sourceType: AvailabilityLedgerSourceType.RESERVATION,
                sourceId: row.id,
                sourceAction: status,
            })
            return tx.warehouseReservation.update({ where: { id }, data: { status } })
        })
    }

    async listTransfers(q: PageQueryDto) {
        const where: Prisma.WarehouseTransferWhereInput = {
            ...(q.status ? { status: q.status as WarehouseTransferStatus } : {}),
            ...(q.keyword ? { transferNo: { contains: q.keyword, mode: 'insensitive' } } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.warehouseTransfer.findMany({
                where,
                ...this.page(q),
                orderBy: { transferDate: 'desc' },
                include: {
                    fromSupplierLocation: true,
                    toSupplierLocation: true,
                    vehicle: true,
                    driver: true,
                    lines: { include: { product: true } },
                },
            }),
            this.prisma.warehouseTransfer.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    transfer(id: string) {
        return this.prisma.warehouseTransfer.findUniqueOrThrow({
            where: { id },
            include: {
                fromSupplierLocation: true,
                toSupplierLocation: true,
                vehicle: true,
                driver: true,
                ownerCustomer: true,
                lines: { include: { product: true } },
                dispatchOrder: true,
            },
        })
    }

    async saveTransfer(dto: UpsertWarehouseTransferDto, id?: string) {
        if (dto.fromSupplierLocationId === dto.toSupplierLocationId) {
            throw new BadRequestException('Source and destination warehouses must differ')
        }
        if (!dto.lines.length) throw new BadRequestException('Transfer requires at least one line')
        const ownerKey = this.availability.ownerKey(dto.ownerType, dto.ownerCustomerId)
        const rowId = await this.prisma.$transaction(async (tx) => {
            if (id) {
                const current = await tx.warehouseTransfer.findUnique({ where: { id } })
                if (!current) throw new NotFoundException('Transfer not found')
                if (current.status !== WarehouseTransferStatus.DRAFT) throw new BadRequestException('Only draft transfer can be edited')
            }
            const data = {
                transferNo: dto.transferNo.trim(),
                fromSupplierLocationId: dto.fromSupplierLocationId,
                toSupplierLocationId: dto.toSupplierLocationId,
                transferDate: new Date(dto.transferDate),
                expectedArrivalDate: dto.expectedArrivalDate ? new Date(dto.expectedArrivalDate) : null,
                actualArrivalDate: dto.actualArrivalDate ? new Date(dto.actualArrivalDate) : null,
                transportMode: dto.transportMode,
                vehicleId: dto.vehicleId ?? null,
                driverId: dto.driverId ?? null,
                ownerType: dto.ownerType,
                ownerKey,
                ownerCustomerId: dto.ownerCustomerId ?? null,
                note: dto.note?.trim() || null,
            }
            const row = id
                ? await tx.warehouseTransfer.update({ where: { id }, data })
                : await tx.warehouseTransfer.create({ data })
            await tx.warehouseTransferLine.deleteMany({ where: { transferId: row.id } })
            await tx.warehouseTransferLine.createMany({
                data: dto.lines.map((line) => ({
                    transferId: row.id,
                    productId: line.productId,
                    qty: line.qty,
                    qtyV15: line.qtyV15,
                    note: line.note?.trim() || null,
                })),
            })
            return row.id
        })
        return this.transfer(rowId)
    }

    async changeTransferStatus(id: string, target: WarehouseTransferStatus, actualArrivalDate?: string) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.warehouseTransfer.findUnique({ where: { id }, include: { lines: true } })
            if (!row) throw new NotFoundException('Transfer not found')
            if (row.status === target) return row

            if (target === WarehouseTransferStatus.CONFIRMED || target === WarehouseTransferStatus.IN_TRANSIT) {
                if (row.status !== WarehouseTransferStatus.DRAFT) throw new BadRequestException('Only draft transfer can be dispatched')
                for (const line of row.lines) {
                    const accounting = await tx.inventoryBalance.findUnique({
                        where: {
                            supplierLocationId_productId: {
                                supplierLocationId: row.fromSupplierLocationId,
                                productId: line.productId,
                            },
                        },
                    })
                    if (!accounting || new Prisma.Decimal(accounting.physicalQty).lessThan(line.qty)) {
                        throw new BadRequestException(`Insufficient accounting inventory for product ${line.productId}`)
                    }
                    const posted = Prisma.Decimal.min(accounting.postedQty, line.qty)
                    const pending = new Prisma.Decimal(line.qty).minus(posted)
                    if (new Prisma.Decimal(accounting.pendingDocQty).lessThan(pending)) {
                        throw new BadRequestException(`Insufficient pending/posted inventory for product ${line.productId}`)
                    }
                    await tx.warehouseTransferLine.update({
                        where: { id: line.id },
                        data: { postedQty: posted, pendingDocQty: pending },
                    })
                    await this.inventory.applyDeltaAndAppendLedger({
                        tx,
                        supplierLocationId: row.fromSupplierLocationId,
                        productId: line.productId,
                        delta: {
                            deltaPhysicalQty: new Prisma.Decimal(line.qty).negated(),
                            deltaPendingDocQty: pending.negated(),
                            deltaPostedQty: posted.negated(),
                        },
                        sourceType: InventoryLedgerSourceType.WAREHOUSE_TRANSFER,
                        sourceId: row.id,
                        occurredAt: new Date(),
                        note: `Dispatch transfer ${row.transferNo}`,
                    })
                    await this.availability.applyDelta({
                        tx,
                        supplierLocationId: row.fromSupplierLocationId,
                        productId: line.productId,
                        ownerType: row.ownerType,
                        ownerCustomerId: row.ownerCustomerId,
                        delta: { availableQty: new Prisma.Decimal(line.qty).negated(), inTransitQty: line.qty },
                        sourceType: AvailabilityLedgerSourceType.WAREHOUSE_TRANSFER,
                        sourceId: row.id,
                        sourceAction: `DISPATCH:${line.id}`,
                    })
                }
                return tx.warehouseTransfer.update({ where: { id }, data: { status: target } })
            }

            if (target === WarehouseTransferStatus.COMPLETED) {
                if (row.status !== WarehouseTransferStatus.CONFIRMED && row.status !== WarehouseTransferStatus.IN_TRANSIT) {
                    throw new BadRequestException('Transfer is not in transit')
                }
                for (const line of row.lines) {
                    await this.inventory.applyDeltaAndAppendLedger({
                        tx,
                        supplierLocationId: row.toSupplierLocationId,
                        productId: line.productId,
                        delta: {
                            deltaPhysicalQty: line.qty,
                            deltaPendingDocQty: line.pendingDocQty,
                            deltaPostedQty: line.postedQty,
                        },
                        sourceType: InventoryLedgerSourceType.WAREHOUSE_TRANSFER,
                        sourceId: row.id,
                        occurredAt: new Date(),
                        note: `Receive transfer ${row.transferNo}`,
                    })
                    await this.availability.applyDelta({
                        tx,
                        supplierLocationId: row.fromSupplierLocationId,
                        productId: line.productId,
                        ownerType: row.ownerType,
                        ownerCustomerId: row.ownerCustomerId,
                        delta: { inTransitQty: new Prisma.Decimal(line.qty).negated() },
                        sourceType: AvailabilityLedgerSourceType.WAREHOUSE_TRANSFER,
                        sourceId: row.id,
                        sourceAction: `COMPLETE-OUT:${line.id}`,
                    })
                    await this.availability.applyDelta({
                        tx,
                        supplierLocationId: row.toSupplierLocationId,
                        productId: line.productId,
                        ownerType: row.ownerType,
                        ownerCustomerId: row.ownerCustomerId,
                        delta: { availableQty: line.qty },
                        sourceType: AvailabilityLedgerSourceType.WAREHOUSE_TRANSFER,
                        sourceId: row.id,
                        sourceAction: `COMPLETE-IN:${line.id}`,
                    })
                }
                return tx.warehouseTransfer.update({
                    where: { id },
                    data: {
                        status: target,
                        actualArrivalDate: actualArrivalDate ? new Date(actualArrivalDate) : new Date(),
                    },
                })
            }

            if (target === WarehouseTransferStatus.CANCELLED) {
                if (row.status === WarehouseTransferStatus.COMPLETED) {
                    throw new BadRequestException('Completed transfer must be corrected by inventory adjustment')
                }
                if (row.status === WarehouseTransferStatus.CONFIRMED || row.status === WarehouseTransferStatus.IN_TRANSIT) {
                    for (const line of row.lines) {
                        await this.inventory.applyDeltaAndAppendLedger({
                            tx,
                            supplierLocationId: row.fromSupplierLocationId,
                            productId: line.productId,
                            delta: {
                                deltaPhysicalQty: line.qty,
                                deltaPendingDocQty: line.pendingDocQty,
                                deltaPostedQty: line.postedQty,
                            },
                            sourceType: InventoryLedgerSourceType.WAREHOUSE_TRANSFER,
                            sourceId: row.id,
                            occurredAt: new Date(),
                            note: `Cancel transfer ${row.transferNo}`,
                        })
                        await this.availability.applyDelta({
                            tx,
                            supplierLocationId: row.fromSupplierLocationId,
                            productId: line.productId,
                            ownerType: row.ownerType,
                            ownerCustomerId: row.ownerCustomerId,
                            delta: { availableQty: line.qty, inTransitQty: new Prisma.Decimal(line.qty).negated() },
                            sourceType: AvailabilityLedgerSourceType.WAREHOUSE_TRANSFER,
                            sourceId: row.id,
                            sourceAction: `CANCEL:${line.id}`,
                        })
                    }
                }
                return tx.warehouseTransfer.update({ where: { id }, data: { status: target } })
            }
            throw new BadRequestException('Unsupported transfer transition')
        })
    }
}
