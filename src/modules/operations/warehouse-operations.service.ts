import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    CommercialLotWithdrawalStatus,
    ExpectedSupplyStatus,
    InventoryDocumentStatus,
    InventoryMovementStatus,
    InventoryMovementType,
    InventoryPostingKind,
    MasterStatus,
    Prisma,
    ReservationStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import {
    AllocateExpectedInventoryDto,
    CreateExpectedInventoryDto,
    CreateWarehouseReservationDto,
    PageQueryDto,
    UpsertStorageRentalContractDto,
    UpsertWarehouseTransferDto,
    PostStorageTermCostDto,
    WarehouseOwnerType,
    WarehouseReservationSourceType,
    WarehouseReservationStatus,
    WarehouseTransferStatus,
} from './dto/operations.dto'

@Injectable()
export class WarehouseOperationsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryCoreService,
    ) {}

    private page(q: PageQueryDto) {
        const page = Math.max(Number(q.page ?? 1) || 1, 1)
        const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200)
        return {
            skip: (page - 1) * pageSize,
            take: pageSize,
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

    private async warehouseContext(tx: Prisma.TransactionClient | PrismaService, warehouseId: string) {
        const warehouse = await tx.warehouse.findUnique({
            where: { id: warehouseId },
            select: { id: true, legalEntityId: true, legalEntity: { select: { partyId: true } } },
        })
        if (!warehouse) throw new NotFoundException('Warehouse not found')
        return warehouse
    }

    private async ownerPartyId(
        tx: Prisma.TransactionClient | PrismaService,
        warehouseId: string,
        ownerType: WarehouseOwnerType,
        ownerCustomerId?: string | null,
    ) {
        if (ownerType !== WarehouseOwnerType.INTERNAL) {
            if (!ownerCustomerId) throw new BadRequestException('OWNER_PARTY_REQUIRED')
            return ownerCustomerId
        }
        if (ownerCustomerId) throw new BadRequestException('INTERNAL_OWNER_MUST_NOT_HAVE_CUSTOMER_ID')
        return (await this.warehouseContext(tx, warehouseId)).legalEntity.partyId
    }

    private oldOwner(ownerPartyId: string, legalEntityPartyId: string) {
        return ownerPartyId === legalEntityPartyId
            ? { ownerType: WarehouseOwnerType.INTERNAL, ownerCustomerId: null }
            : { ownerType: WarehouseOwnerType.CUSTOMER, ownerCustomerId: ownerPartyId }
    }

    async listAvailability(
        q: PageQueryDto & { supplierLocationId?: string; productId?: string; ownerType?: WarehouseOwnerType },
    ) {
        const where: Prisma.InventoryAvailabilityBalanceWhereInput = {
            ...(q.supplierLocationId ? { warehouseId: q.supplierLocationId } : {}),
            ...(q.productId ? { productId: q.productId } : {}),
            ...(q.ownerType === WarehouseOwnerType.INTERNAL
                ? { owner: { legalEntities: { some: {} } } }
                : q.ownerType
                  ? { owner: { legalEntities: { none: {} } } }
                  : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.inventoryAvailabilityBalance.findMany({
                where,
                ...this.page(q),
                orderBy: [{ warehouse: { name: 'asc' } }, { product: { name: 'asc' } }],
                include: {
                    warehouse: {
                        select: {
                            id: true,
                            code: true,
                            name: true,
                            legalEntity: { select: { partyId: true } },
                        },
                    },
                    product: { select: { id: true, code: true, name: true, uom: true } },
                    owner: { select: { id: true, code: true, name: true } },
                },
            }),
            this.prisma.inventoryAvailabilityBalance.count({ where }),
        ])
        return {
            items: items.map((item) => {
                const availableQty = new Prisma.Decimal(item.onHandActualQty)
                    .minus(item.pendingActualQty)
                    .minus(item.blockedActualQty)
                return {
                    ...item,
                    supplierLocationId: item.warehouseId,
                    supplierLocation: item.warehouse,
                    ownerCustomer: item.owner,
                    ...this.oldOwner(item.ownerPartyId, item.warehouse.legalEntity.partyId),
                    availableQty,
                    reservedQty: item.reservedActualQty,
                    sellableQty: availableQty.minus(item.reservedActualQty),
                    pendingReleaseQty: item.pendingActualQty,
                    blockedQty: item.blockedActualQty,
                }
            }),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async inventoryMatrix(q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
        const availability = await this.listAvailability(q)
        const stock = await this.prisma.stockBalance.findMany({
            where: {
                ...(q.supplierLocationId ? { warehouseId: q.supplierLocationId } : {}),
                ...(q.productId ? { productId: q.productId } : {}),
            },
            include: {
                warehouse: { select: { id: true, code: true, name: true } },
                product: { select: { id: true, code: true, name: true, uom: true } },
                owner: { select: { id: true, code: true, name: true } },
                lot: { select: { id: true, lotNo: true, receivedAt: true } },
            },
            orderBy: [{ warehouse: { name: 'asc' } }, { product: { name: 'asc' } }, { lot: { receivedAt: 'asc' } }],
        })
        return {
            availability,
            accounting: stock.map((item) => ({
                ...item,
                supplierLocationId: item.warehouseId,
                supplierLocation: item.warehouse,
                physicalQty: item.actualQty,
                postedQty: item.actualQty,
                pendingDocQty: new Prisma.Decimal(0),
            })),
        }
    }

    async listCommercialLotInventory(q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
        const [positions, pendingOrderLines] = await this.prisma.$transaction([
            this.prisma.commercialLotPosition.findMany({
            where: {
                invoicedQty: { gt: new Prisma.Decimal(0) },
                ...(q.supplierLocationId
                    ? {
                          OR: [
                              { plannedWarehouseId: q.supplierLocationId },
                              {
                                  withdrawalLines: {
                                      some: {
                                          withdrawal: {
                                              status: CommercialLotWithdrawalStatus.CONFIRMED,
                                              destinationWarehouseId: q.supplierLocationId,
                                          },
                                      },
                                  },
                              },
                          ],
                      }
                    : {}),
                ...(q.productId ? { productId: q.productId } : {}),
            },
            include: {
                supplier: { select: { id: true, code: true, name: true } },
                plannedWarehouse: { select: { id: true, code: true, name: true } },
                product: { select: { id: true, code: true, name: true, uom: true } },
                purchaseOrderLine: {
                    select: {
                        purchaseOrder: { select: { id: true, orderNo: true } },
                    },
                },
                withdrawalLines: {
                    where: { withdrawal: { status: CommercialLotWithdrawalStatus.CONFIRMED } },
                    select: {
                        actualQty: true,
                        withdrawal: {
                            select: {
                                destinationWarehouseId: true,
                                destinationWarehouse: { select: { id: true, code: true, name: true } },
                            },
                        },
                    },
                },
            },
            orderBy: [
                { plannedWarehouse: { name: 'asc' } },
                { supplier: { name: 'asc' } },
                { product: { name: 'asc' } },
            ],
            }),
            this.prisma.purchaseOrderLine.findMany({
                where: {
                    ...(q.supplierLocationId ? { receivingWarehouseId: q.supplierLocationId } : {}),
                    ...(q.productId ? { productId: q.productId } : {}),
                    purchaseOrder: {
                        orderType: 'LOT',
                        bizType: 'COMMERCIAL',
                        status: { in: ['DRAFT', 'APPROVED', 'IN_PROGRESS'] },
                    },
                },
                include: {
                    product: { select: { id: true, code: true, name: true, uom: true } },
                    receivingWarehouse: { select: { id: true, code: true, name: true } },
                    commercialLotPosition: { select: { invoicedQty: true } },
                    purchaseOrder: {
                        select: {
                            id: true,
                            orderNo: true,
                            supplier: { select: { id: true, code: true, name: true } },
                        },
                    },
                },
                orderBy: [
                    { receivingWarehouse: { name: 'asc' } },
                    { purchaseOrder: { supplier: { name: 'asc' } } },
                    { product: { name: 'asc' } },
                ],
            }),
        ])

        const invoiceRows = positions
            .flatMap((position) => {
                const allocatedByWarehouse = new Map<
                    string,
                    { warehouse: typeof position.plannedWarehouse; qty: Prisma.Decimal }
                >([
                    [
                        position.plannedWarehouseId,
                        { warehouse: position.plannedWarehouse, qty: new Prisma.Decimal(position.invoicedQty) },
                    ],
                ])
                for (const line of position.withdrawalLines) {
                    const warehouseId = line.withdrawal.destinationWarehouseId
                    if (warehouseId === position.plannedWarehouseId) continue
                    const planned = allocatedByWarehouse.get(position.plannedWarehouseId)!
                    planned.qty = planned.qty.minus(line.actualQty)
                    const destination = allocatedByWarehouse.get(warehouseId)
                    allocatedByWarehouse.set(warehouseId, {
                        warehouse: line.withdrawal.destinationWarehouse,
                        qty: (destination?.qty ?? new Prisma.Decimal(0)).plus(line.actualQty),
                    })
                }
                const isExportable = position.stockState === 'EXPORTABLE'
                const isTemporary = position.stockState === 'TEMPORARY_EXPORT'

                return [...allocatedByWarehouse.entries()]
                    .filter(([, allocation]) => allocation.qty.greaterThan(0))
                    .map(([warehouseId, allocation]) => {
                        const accountingValue = position.invoicedQty.isZero()
                            ? new Prisma.Decimal(0)
                            : position.accountingValue.mul(allocation.qty).div(position.invoicedQty)
                        return {
                            id: `commercial-lot:${position.id}:warehouse:${warehouseId}`,
                            source: 'COMMERCIAL_LOT',
                            includeInAccounting: true,
                            commercialLotPositionId: position.id,
                            supplierLocationId: warehouseId,
                            supplierLocation: allocation.warehouse,
                            supplier: position.supplier,
                            product: position.product,
                            orderNo: position.purchaseOrderLine.purchaseOrder.orderNo,
                            stockState: position.stockState,
                            accountingQty: allocation.qty,
                            accountingValue,
                            exportableQty: isExportable ? allocation.qty : new Prisma.Decimal(0),
                            temporaryExportQty: isTemporary ? allocation.qty : new Prisma.Decimal(0),
                            nonExportableQty: !isExportable && !isTemporary ? allocation.qty : new Prisma.Decimal(0),
                        }
                    })
            })

        const pendingOrderRows = pendingOrderLines
            .map((line) => {
                const invoicedQty = line.commercialLotPosition?.invoicedQty ?? new Prisma.Decimal(0)
                const expectedQty = line.actualReceivedQty ?? line.orderedQty
                const pendingInvoiceQty = expectedQty.minus(invoicedQty)
                if (pendingInvoiceQty.lessThanOrEqualTo(0)) return null

                return {
                    id: `commercial-lot-order:${line.id}`,
                    source: 'COMMERCIAL_LOT_ORDER',
                    includeInAccounting: false,
                    purchaseOrderLineId: line.id,
                    supplierLocationId: line.receivingWarehouseId,
                    supplierLocation: line.receivingWarehouse,
                    supplier: line.purchaseOrder.supplier,
                    product: line.product,
                    orderNo: line.purchaseOrder.orderNo,
                    stockState: 'NON_EXPORTABLE',
                    accountingQty: new Prisma.Decimal(0),
                    accountingValue: new Prisma.Decimal(0),
                    exportableQty: new Prisma.Decimal(0),
                    temporaryExportQty: new Prisma.Decimal(0),
                    nonExportableQty: pendingInvoiceQty,
                }
            })
            .filter((row): row is NonNullable<typeof row> => row !== null)

        const rows = [...invoiceRows, ...pendingOrderRows]

        const page = Math.max(Number(q.page ?? 1) || 1, 1)
        const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200)
        return {
            items: rows.slice((page - 1) * pageSize, page * pageSize),
            total: rows.length,
            page,
            pageSize,
        }
    }

    private async activeWarehouseLocation(
        tx: Prisma.TransactionClient | PrismaService,
        areaId: string,
        warehouseId?: string | null,
    ) {
        const area = await tx.warehouseArea.findFirst({
            where: { id: areaId, status: MasterStatus.ACTIVE },
            select: { id: true, code: true, name: true },
        })
        if (!area) throw new BadRequestException('WAREHOUSE_AREA_INVALID')
        if (!warehouseId) return { area, warehouse: null }
        const warehouse = await tx.warehouse.findFirst({
            where: { id: warehouseId, areaId, status: MasterStatus.ACTIVE, isOperationalWarehouse: true },
            select: { id: true, code: true, name: true, legalEntityId: true, areaId: true },
        })
        if (!warehouse) throw new BadRequestException('WAREHOUSE_NOT_IN_SELECTED_AREA')
        return { area, warehouse }
    }

    private async expectedSource(
        tx: Prisma.TransactionClient,
        dto: CreateExpectedInventoryDto,
    ): Promise<Pick<Prisma.ExpectedSupplyUncheckedCreateInput, 'purchaseOrderLineId' | 'movementLineId' | 'manualReference'>> {
        if (dto.sourceType === 'WAREHOUSE_TRANSFER') {
            const line = await tx.inventoryMovementLine.findFirst({
                where: { movementId: dto.sourceId, productId: dto.productId },
                select: { id: true },
            })
            if (!line) throw new BadRequestException('MOVEMENT_LINE_NOT_FOUND')
            return { movementLineId: line.id }
        }
        if (dto.sourceType === 'PURCHASE_ORDER' || dto.sourceType === 'SHIP_CHARTER_ORDER') {
            let purchaseOrderId = dto.sourceId
            if (dto.sourceType === 'SHIP_CHARTER_ORDER') {
                const charter = await tx.shipCharterOrder.findUnique({
                    where: { id: dto.sourceId },
                    select: { purchaseOrderId: true },
                })
                if (!charter?.purchaseOrderId) throw new BadRequestException('SHIP_CHARTER_PURCHASE_ORDER_NOT_FOUND')
                purchaseOrderId = charter.purchaseOrderId
            }
            const line = await tx.purchaseOrderLine.findFirst({
                where: { purchaseOrderId, productId: dto.productId },
                select: { id: true },
            })
            if (!line) throw new BadRequestException('PURCHASE_ORDER_LINE_NOT_FOUND')
            return { purchaseOrderLineId: line.id }
        }
        return { manualReference: `MANUAL:${dto.sourceId}` }
    }

    private async expectedOwnerPartyId(
        tx: Prisma.TransactionClient,
        dto: CreateExpectedInventoryDto,
        source: Pick<Prisma.ExpectedSupplyUncheckedCreateInput, 'purchaseOrderLineId' | 'movementLineId' | 'manualReference'>,
    ) {
        if (dto.ownerType !== WarehouseOwnerType.INTERNAL) {
            if (!dto.ownerCustomerId) throw new BadRequestException('OWNER_PARTY_REQUIRED')
            return dto.ownerCustomerId
        }
        if (dto.ownerCustomerId) throw new BadRequestException('INTERNAL_OWNER_MUST_NOT_HAVE_CUSTOMER_ID')
        if (dto.supplierLocationId) {
            return (await this.warehouseContext(tx, dto.supplierLocationId)).legalEntity.partyId
        }
        if (source.purchaseOrderLineId) {
            const line = await tx.purchaseOrderLine.findUnique({
                where: { id: source.purchaseOrderLineId },
                select: { purchaseOrder: { select: { legalEntity: { select: { partyId: true } } } } },
            })
            if (line) return line.purchaseOrder.legalEntity.partyId
        }
        if (source.movementLineId) {
            const line = await tx.inventoryMovementLine.findUnique({
                where: { id: source.movementLineId },
                select: { ownerPartyId: true },
            })
            if (line) return line.ownerPartyId
        }
        const legalEntity = await tx.legalEntity.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { partyId: true },
        })
        if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_REQUIRED')
        return legalEntity.partyId
    }

    async createExpected(dto: CreateExpectedInventoryDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.activeWarehouseLocation(tx, dto.warehouseAreaId, dto.supplierLocationId)
            const source = await this.expectedSource(tx, dto)
            const ownerPartyId = await this.expectedOwnerPartyId(tx, dto, source)
            const locationKey = dto.supplierLocationId ?? `AREA-${dto.warehouseAreaId}`
            return tx.expectedSupply.create({
                data: {
                    expectedNo: `EXP-${dto.sourceType}-${dto.sourceId}-${dto.productId}-${locationKey}`,
                    warehouseAreaId: dto.warehouseAreaId,
                    warehouseId: dto.supplierLocationId ?? null,
                    productId: dto.productId,
                    ownerPartyId,
                    ...source,
                    expectedActualQty: dto.expectedQty,
                    expectedAt: dto.expectedDate ? new Date(dto.expectedDate) : null,
                },
            })
        })
    }

    async listExpected(q: PageQueryDto) {
        const status = q.status
            ? q.status === 'PARTIALLY_RECEIVED'
                ? ExpectedSupplyStatus.PARTIALLY_FULFILLED
                : q.status === 'RECEIVED'
                  ? ExpectedSupplyStatus.FULFILLED
                  : (q.status as ExpectedSupplyStatus)
            : undefined
        const where: Prisma.ExpectedSupplyWhereInput = { ...(status ? { status } : {}) }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.expectedSupply.findMany({
                where,
                ...this.page(q),
                orderBy: [{ expectedAt: 'asc' }, { expectedNo: 'desc' }],
                include: { warehouseArea: true, warehouse: true, product: true, owner: true },
            }),
            this.prisma.expectedSupply.count({ where }),
        ])
        return {
            items: items.map((item) => ({
                ...item,
                supplierLocationId: item.warehouseId,
                supplierLocation: item.warehouse,
                ownerCustomerId: item.ownerPartyId,
                ownerCustomer: item.owner,
                expectedQty: item.expectedActualQty,
                receivedQty: item.fulfilledActualQty,
                expectedDate: item.expectedAt,
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async allocateExpected(id: string, dto: AllocateExpectedInventoryDto) {
        return this.prisma.$transaction(async (tx) => {
            const supply = await tx.expectedSupply.findUnique({ where: { id } })
            if (!supply) throw new NotFoundException('Expected supply not found')
            if (supply.status !== ExpectedSupplyStatus.OPEN && supply.status !== ExpectedSupplyStatus.PARTIALLY_FULFILLED) {
                throw new BadRequestException('Expected supply is not open')
            }
            const receiptLine = await tx.goodsReceiptLine.findFirst({
                where: {
                    goodsReceiptId: dto.goodsReceiptId,
                    productId: supply.productId,
                    ownerPartyId: supply.ownerPartyId,
                    goodsReceipt: {
                        ...(supply.warehouseId
                            ? { warehouseId: supply.warehouseId }
                            : { warehouse: { areaId: supply.warehouseAreaId } }),
                    },
                },
                include: { goodsReceipt: { select: { warehouseId: true } } },
            })
            if (!receiptLine) throw new BadRequestException('MATCHING_RECEIPT_LINE_NOT_FOUND')
            const existing = await tx.expectedSupplyAllocation.findUnique({
                where: { expectedSupplyId_receiptLineId: { expectedSupplyId: id, receiptLineId: receiptLine.id } },
            })
            if (existing) return existing
            const allocated = new Prisma.Decimal(dto.allocatedQty)
            const remaining = new Prisma.Decimal(supply.expectedActualQty).minus(supply.fulfilledActualQty)
            if (allocated.greaterThan(remaining) || allocated.greaterThan(receiptLine.actualQty)) {
                throw new BadRequestException('Allocated quantity exceeds remainder')
            }
            const allocation = await tx.expectedSupplyAllocation.create({
                data: {
                    expectedSupplyId: id,
                    receiptLineId: receiptLine.id,
                    actualQty: allocated,
                    idempotencyKey: `expected:${id}:receipt-line:${receiptLine.id}`,
                },
            })
            const fulfilledActualQty = new Prisma.Decimal(supply.fulfilledActualQty).plus(allocated)
            await tx.expectedSupply.update({
                where: { id },
                data: {
                    fulfilledActualQty,
                    status: fulfilledActualQty.equals(supply.expectedActualQty)
                        ? ExpectedSupplyStatus.FULFILLED
                        : ExpectedSupplyStatus.PARTIALLY_FULFILLED,
                    ...(supply.warehouseId ? {} : { warehouseId: receiptLine.goodsReceipt.warehouseId }),
                    version: { increment: 1 },
                },
            })
            return allocation
        })
    }

    async cancelExpected(id: string) {
        const row = await this.prisma.expectedSupply.findUnique({ where: { id } })
        if (!row) throw new NotFoundException('Expected supply not found')
        if (row.status === ExpectedSupplyStatus.FULFILLED) {
            throw new BadRequestException('Fulfilled expectation cannot be cancelled')
        }
        if (row.status === ExpectedSupplyStatus.CANCELLED) return row
        return this.prisma.expectedSupply.update({
            where: { id },
            data: { status: ExpectedSupplyStatus.CANCELLED, version: { increment: 1 } },
        })
    }

    private reservationStatus(status?: string): ReservationStatus | undefined {
        if (!status) return undefined
        return status as ReservationStatus
    }

    async listReservations(q: PageQueryDto) {
        const where: Prisma.InventoryReservationWhereInput = {
            ...(this.reservationStatus(q.status) ? { status: this.reservationStatus(q.status) } : {}),
            ...(q.keyword?.trim()
                ? {
                      OR: [
                          { reservationNo: { contains: q.keyword.trim(), mode: 'insensitive' } },
                          { customer: { name: { contains: q.keyword.trim(), mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.inventoryReservation.findMany({
                where,
                ...this.page(q),
                orderBy: { createdAt: 'desc' },
                include: {
                    customer: { select: { id: true, code: true, name: true } },
                    salesOrder: { select: { id: true, orderNo: true } },
                    lines: {
                        orderBy: { lineNo: 'asc' },
                        include: {
                            warehouse: {
                                select: {
                                    id: true,
                                    code: true,
                                    name: true,
                                    legalEntity: { select: { partyId: true } },
                                },
                            },
                            product: { select: { id: true, code: true, name: true, uom: true } },
                            owner: { select: { id: true, code: true, name: true } },
                            lot: { select: { id: true, lotNo: true } },
                        },
                    },
                },
            }),
            this.prisma.inventoryReservation.count({ where }),
        ])
        return {
            items: rows.map((row) => {
                const line = row.lines[0]
                return {
                    ...row,
                    supplierLocationId: line?.warehouseId,
                    supplierLocation: line?.warehouse,
                    productId: line?.productId,
                    product: line?.product,
                    customerId: row.customerPartyId,
                    sourceType: row.salesOrderId ? 'SALES_ORDER' : 'MANUAL',
                    sourceId: row.salesOrderId ?? row.manualReference,
                    reservedQty: row.lines.reduce(
                        (sum, item) => sum.plus(item.requestedActualQty),
                        new Prisma.Decimal(0),
                    ),
                    activeQty: row.lines.reduce(
                        (sum, item) => sum.plus(item.activeActualQty),
                        new Prisma.Decimal(0),
                    ),
                    expiredAt: row.expiresAt,
                }
            }),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async createReservation(dto: CreateWarehouseReservationDto) {
        return this.prisma.$transaction(async (tx) => {
            const warehouse = await this.warehouseContext(tx, dto.supplierLocationId)
            const existing = await tx.inventoryReservation.findUnique({
                where: { reservationNo: dto.reservationNo.trim() },
                include: { lines: true },
            })
            if (existing) return existing

            let customerPartyId = dto.customerId ?? null
            let salesOrderId: string | null = null
            let manualReference: string | null = null
            if (dto.sourceType === WarehouseReservationSourceType.SALES_ORDER) {
                if (!dto.sourceId) {
                    throw new BadRequestException('RESERVATION_SALES_ORDER_REQUIRED')
                }
                const salesOrder = await tx.salesOrder.findUnique({
                    where: { id: dto.sourceId },
                    select: { id: true, legalEntityId: true, customerPartyId: true },
                })
                if (!salesOrder) throw new NotFoundException('Sales order not found')
                if (salesOrder.legalEntityId !== warehouse.legalEntityId) {
                    throw new BadRequestException('RESERVATION_SALES_ORDER_LEGAL_ENTITY_MISMATCH')
                }
                if (customerPartyId && customerPartyId !== salesOrder.customerPartyId) {
                    throw new BadRequestException('RESERVATION_SALES_ORDER_CUSTOMER_MISMATCH')
                }
                salesOrderId = salesOrder.id
                customerPartyId = salesOrder.customerPartyId
            } else {
                manualReference = dto.sourceId ?? dto.reservationNo.trim()
            }

            const reservation = await tx.inventoryReservation.create({
                data: {
                    reservationNo: dto.reservationNo.trim(),
                    legalEntityId: warehouse.legalEntityId,
                    customerPartyId,
                    salesOrderId,
                    manualReference,
                    reservedAt: dto.reservedAt ? new Date(dto.reservedAt) : new Date(),
                    expiresAt: dto.expiredAt ? new Date(dto.expiredAt) : null,
                    note: dto.note?.trim() || null,
                    lines: {
                        create: {
                            lineNo: 1,
                            warehouseId: dto.supplierLocationId,
                            productId: dto.productId,
                            ownerPartyId: warehouse.legalEntity.partyId,
                            requestedActualQty: dto.reservedQty,
                        },
                    },
                },
                include: { lines: true },
            })
            await this.inventory.activateReservationLine(tx, {
                reservationLineId: reservation.lines[0].id,
                actualQty: dto.reservedQty,
                idempotencyKey: `reservation:${reservation.id}:activate:1`,
                occurredAt: reservation.reservedAt,
                reason: dto.note,
            })
            return tx.inventoryReservation.findUniqueOrThrow({
                where: { id: reservation.id },
                include: { lines: true },
            })
        })
    }

    async changeReservation(id: string, requestedStatus: WarehouseReservationStatus) {
        const target = requestedStatus as unknown as ReservationStatus
        if (target === ReservationStatus.ACTIVE) {
            return this.prisma.inventoryReservation.findUniqueOrThrow({ where: { id }, include: { lines: true } })
        }
        if (
            target !== ReservationStatus.RELEASED &&
            target !== ReservationStatus.CANCELLED &&
            target !== ReservationStatus.CONSUMED
        ) {
            throw new BadRequestException('RESERVATION_STATUS_TRANSITION_NOT_SUPPORTED')
        }
        return this.prisma.$transaction(async (tx) => {
            const reservation = await tx.inventoryReservation.findUnique({
                where: { id },
                include: { lines: true },
            })
            if (!reservation) throw new NotFoundException('Reservation not found')
            if (reservation.status === target) return reservation
            if (reservation.status !== ReservationStatus.ACTIVE && reservation.status !== ReservationStatus.PARTIALLY_RELEASED) {
                throw new BadRequestException('RESERVATION_IS_NOT_ACTIVE')
            }
            for (const line of reservation.lines) {
                if (!line.activeActualQty.isPositive()) continue
                const args = {
                    reservationLineId: line.id,
                    actualQty: line.activeActualQty,
                    v15Qty: line.activeV15Qty,
                    idempotencyKey: `reservation:${reservation.id}:${target.toLowerCase()}:${line.lineNo}`,
                    occurredAt: new Date(),
                    reason: `Chuyển trạng thái phiếu giữ hàng sang ${target}`,
                }
                if (target === ReservationStatus.CONSUMED) {
                    await this.inventory.consumeReservationLine(tx, args)
                } else {
                    await this.inventory.releaseReservationLine(tx, args)
                }
            }
            return tx.inventoryReservation.update({
                where: { id },
                data: { status: target, version: { increment: 1 } },
                include: { lines: true },
            })
        })
    }

    private movementStatus(status?: string): InventoryMovementStatus | undefined {
        if (!status) return undefined
        if (status === WarehouseTransferStatus.CONFIRMED) return InventoryMovementStatus.READY
        return status as InventoryMovementStatus
    }

    private transferStatus(status: InventoryMovementStatus): WarehouseTransferStatus {
        if (status === InventoryMovementStatus.READY) return WarehouseTransferStatus.CONFIRMED
        if (status === InventoryMovementStatus.PARTIALLY_ARRIVED) return WarehouseTransferStatus.IN_TRANSIT
        return status as unknown as WarehouseTransferStatus
    }

    private async movementWithDetails(tx: Prisma.TransactionClient | PrismaService, id: string) {
        return tx.inventoryMovement.findUnique({
            where: { id },
            include: {
                legalEntity: true,
                fromWarehouse: { include: { legalEntity: { select: { partyId: true } } } },
                toWarehouse: true,
                vehicle: true,
                driver: true,
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: { product: true, owner: true, lot: true },
                },
                dispatches: { include: { lines: true }, orderBy: { dispatchedAt: 'asc' } },
                arrivals: { include: { lines: true }, orderBy: { arrivedAt: 'asc' } },
            },
        })
    }

    private toTransferResponse<T extends NonNullable<Awaited<ReturnType<WarehouseOperationsService['movementWithDetails']>>>>(
        movement: T,
    ) {
        const grouped = new Map<
            string,
            {
                id: string
                productId: string
                product: T['lines'][number]['product']
                qty: Prisma.Decimal
                qtyV15: Prisma.Decimal | null
                pendingDocQty: Prisma.Decimal
                postedQty: Prisma.Decimal
                note: string | null
            }
        >()
        const dispatchedByLine = new Map<string, Prisma.Decimal>()
        for (const dispatch of movement.dispatches) {
            if (dispatch.status !== InventoryDocumentStatus.POSTED) continue
            for (const line of dispatch.lines) {
                dispatchedByLine.set(
                    line.movementLineId,
                    (dispatchedByLine.get(line.movementLineId) ?? new Prisma.Decimal(0)).plus(line.actualQty),
                )
            }
        }
        for (const line of movement.lines) {
            const current = grouped.get(line.productId)
            const postedQty = dispatchedByLine.get(line.id) ?? new Prisma.Decimal(0)
            if (current) {
                current.qty = current.qty.plus(line.plannedActualQty)
                current.qtyV15 =
                    current.qtyV15 == null && line.plannedV15Qty == null
                        ? null
                        : new Prisma.Decimal(current.qtyV15 ?? 0).plus(line.plannedV15Qty ?? 0)
                current.postedQty = current.postedQty.plus(postedQty)
                current.pendingDocQty = current.qty.minus(current.postedQty)
            } else {
                grouped.set(line.productId, {
                    id: line.id,
                    productId: line.productId,
                    product: line.product,
                    qty: line.plannedActualQty,
                    qtyV15: line.plannedV15Qty,
                    pendingDocQty: line.plannedActualQty.minus(postedQty),
                    postedQty,
                    note: line.note,
                })
            }
        }
        const ownerPartyId = movement.lines[0]?.ownerPartyId
        const internalPartyId = movement.fromWarehouse?.legalEntity.partyId
        return {
            ...movement,
            transferNo: movement.movementNo,
            fromSupplierLocationId: movement.fromWarehouseId,
            fromSupplierLocation: movement.fromWarehouse,
            toSupplierLocationId: movement.toWarehouseId,
            toSupplierLocation: movement.toWarehouse,
            transferDate: movement.plannedAt,
            expectedArrivalDate: movement.expectedArrivalAt,
            actualArrivalDate: movement.actualArrivalAt,
            status: this.transferStatus(movement.status),
            ownerCustomerId: ownerPartyId && ownerPartyId !== internalPartyId ? ownerPartyId : null,
            ownerCustomer: movement.lines[0]?.owner ?? null,
            ownerType:
                ownerPartyId && ownerPartyId === internalPartyId
                    ? WarehouseOwnerType.INTERNAL
                    : WarehouseOwnerType.CUSTOMER,
            lines: [...grouped.values()],
        }
    }

    async listTransfers(q: PageQueryDto) {
        const keyword = q.keyword?.trim()
        const where: Prisma.InventoryMovementWhereInput = {
            type: InventoryMovementType.WAREHOUSE_TRANSFER,
            ...(this.movementStatus(q.status) ? { status: this.movementStatus(q.status) } : {}),
            ...(keyword
                ? {
                      OR: [
                          { movementNo: { contains: keyword, mode: 'insensitive' } },
                          { fromWarehouse: { name: { contains: keyword, mode: 'insensitive' } } },
                          { toWarehouse: { name: { contains: keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.inventoryMovement.findMany({
                where,
                ...this.page(q),
                orderBy: { createdAt: 'desc' },
                include: {
                    legalEntity: true,
                    fromWarehouse: { include: { legalEntity: { select: { partyId: true } } } },
                    toWarehouse: true,
                    vehicle: true,
                    driver: true,
                    lines: { orderBy: { lineNo: 'asc' }, include: { product: true, owner: true, lot: true } },
                    dispatches: { include: { lines: true }, orderBy: { dispatchedAt: 'asc' } },
                    arrivals: { include: { lines: true }, orderBy: { arrivedAt: 'asc' } },
                },
            }),
            this.prisma.inventoryMovement.count({ where }),
        ])
        return {
            items: rows.map((row) => this.toTransferResponse(row)),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async transfer(id: string) {
        const movement = await this.movementWithDetails(this.prisma, id)
        if (!movement) throw new NotFoundException('Warehouse transfer not found')
        return this.toTransferResponse(movement)
    }

    private aggregateTransferLines(dto: UpsertWarehouseTransferDto) {
        const lines = new Map<string, { qty: Prisma.Decimal; qtyV15: Prisma.Decimal | null; note: string | null }>()
        for (const input of dto.lines) {
            const qty = new Prisma.Decimal(input.qty)
            const qtyV15 = input.qtyV15 == null ? null : new Prisma.Decimal(input.qtyV15)
            const current = lines.get(input.productId)
            if (current) {
                current.qty = current.qty.plus(qty)
                current.qtyV15 =
                    current.qtyV15 == null && qtyV15 == null
                        ? null
                        : new Prisma.Decimal(current.qtyV15 ?? 0).plus(qtyV15 ?? 0)
                current.note = current.note || input.note?.trim() || null
            } else {
                lines.set(input.productId, { qty, qtyV15, note: input.note?.trim() || null })
            }
        }
        if (!lines.size) throw new BadRequestException('WAREHOUSE_TRANSFER_REQUIRES_LINES')
        return lines
    }

    async saveTransfer(dto: UpsertWarehouseTransferDto, id?: string) {
        if (dto.fromSupplierLocationId === dto.toSupplierLocationId) {
            throw new BadRequestException('TRANSFER_WAREHOUSES_MUST_BE_DIFFERENT')
        }
        const requestedLines = this.aggregateTransferLines(dto)
        const movementId = await this.prisma.$transaction(async (tx) => {
            const [fromWarehouse, toWarehouse] = await Promise.all([
                this.warehouseContext(tx, dto.fromSupplierLocationId),
                this.warehouseContext(tx, dto.toSupplierLocationId),
            ])
            if (fromWarehouse.legalEntityId !== toWarehouse.legalEntityId) {
                throw new BadRequestException('CROSS_LEGAL_ENTITY_MOVEMENT_REQUIRES_OWNERSHIP_TRANSFER')
            }
            const ownerPartyId = await this.ownerPartyId(
                tx,
                dto.fromSupplierLocationId,
                dto.ownerType,
                dto.ownerCustomerId,
            )
            if (id) {
                const current = await tx.inventoryMovement.findUnique({ where: { id } })
                if (!current) throw new NotFoundException('Warehouse transfer not found')
                if (current.status !== InventoryMovementStatus.DRAFT) {
                    throw new BadRequestException('ONLY_DRAFT_MOVEMENT_CAN_BE_EDITED')
                }
                await tx.expectedSupply.deleteMany({ where: { movementLine: { movementId: id } } })
                await tx.inventoryMovementLine.deleteMany({ where: { movementId: id } })
            }
            const movement = id
                ? await tx.inventoryMovement.update({
                      where: { id },
                      data: {
                          movementNo: dto.transferNo.trim(),
                          fromWarehouseId: dto.fromSupplierLocationId,
                          toWarehouseId: dto.toSupplierLocationId,
                          vehicleId: dto.vehicleId ?? null,
                          driverId: dto.driverId ?? null,
                          transportMode: dto.transportMode,
                          plannedAt: new Date(dto.transferDate),
                          expectedArrivalAt: dto.expectedArrivalDate ? new Date(dto.expectedArrivalDate) : null,
                          actualArrivalAt: dto.actualArrivalDate ? new Date(dto.actualArrivalDate) : null,
                          note: dto.note?.trim() || null,
                          version: { increment: 1 },
                      },
                  })
                : await tx.inventoryMovement.create({
                      data: {
                          movementNo: dto.transferNo.trim(),
                          legalEntityId: fromWarehouse.legalEntityId,
                          type: InventoryMovementType.WAREHOUSE_TRANSFER,
                          fromWarehouseId: dto.fromSupplierLocationId,
                          toWarehouseId: dto.toSupplierLocationId,
                          vehicleId: dto.vehicleId ?? null,
                          driverId: dto.driverId ?? null,
                          transportMode: dto.transportMode,
                          plannedAt: new Date(dto.transferDate),
                          expectedArrivalAt: dto.expectedArrivalDate ? new Date(dto.expectedArrivalDate) : null,
                          actualArrivalAt: dto.actualArrivalDate ? new Date(dto.actualArrivalDate) : null,
                          note: dto.note?.trim() || null,
                      },
                  })

            let lineNo = 1
            for (const [productId, requested] of requestedLines) {
                const availability = await tx.inventoryAvailabilityBalance.findUnique({
                    where: {
                        warehouseId_productId_ownerPartyId: {
                            warehouseId: dto.fromSupplierLocationId,
                            productId,
                            ownerPartyId,
                        },
                    },
                })
                const sellable = availability
                    ? new Prisma.Decimal(availability.onHandActualQty)
                          .minus(availability.reservedActualQty)
                          .minus(availability.pendingActualQty)
                          .minus(availability.blockedActualQty)
                    : new Prisma.Decimal(0)
                if (sellable.lessThan(requested.qty)) {
                    throw new BadRequestException({ code: 'INSUFFICIENT_SELLABLE_STOCK', productId })
                }
                const stocks = await tx.stockBalance.findMany({
                    where: {
                        warehouseId: dto.fromSupplierLocationId,
                        productId,
                        ownerPartyId,
                        actualQty: { gt: 0 },
                    },
                    include: { lot: true },
                    orderBy: [{ lot: { receivedAt: 'asc' } }, { id: 'asc' }],
                })
                let remaining = requested.qty
                let remainingV15 = requested.qtyV15
                for (const stock of stocks) {
                    if (!remaining.isPositive()) break
                    const take = Prisma.Decimal.min(remaining, stock.actualQty)
                    const isLast = take.equals(remaining)
                    const takeV15 =
                        remainingV15 == null
                            ? null
                            : isLast
                              ? remainingV15
                              : requested.qtyV15!.mul(take).div(requested.qty)
                    await tx.inventoryMovementLine.create({
                        data: {
                            movementId: movement.id,
                            lineNo,
                            productId,
                            ownerPartyId,
                            inventoryLotId: stock.inventoryLotId,
                            plannedActualQty: take,
                            plannedV15Qty: takeV15,
                            note: requested.note,
                        },
                    })
                    lineNo += 1
                    remaining = remaining.minus(take)
                    if (remainingV15 != null) remainingV15 = remainingV15.minus(takeV15 ?? 0)
                }
                if (remaining.isPositive()) {
                    throw new BadRequestException({ code: 'STOCK_LOT_ALLOCATION_FAILED', productId })
                }
            }

            const movementLines = await tx.inventoryMovementLine.findMany({ where: { movementId: movement.id } })
            await tx.expectedSupply.createMany({
                data: movementLines.map((line) => ({
                    expectedNo: `EXP-MOVE-${movement.id}-${line.lineNo}`,
                    warehouseId: dto.toSupplierLocationId,
                    productId: line.productId,
                    ownerPartyId: line.ownerPartyId,
                    movementLineId: line.id,
                    expectedActualQty: line.plannedActualQty,
                    expectedV15Qty: line.plannedV15Qty,
                    expectedAt: dto.expectedArrivalDate ? new Date(dto.expectedArrivalDate) : null,
                })),
            })
            return movement.id
        })
        return this.transfer(movementId)
    }

    private async confirmMovement(id: string) {
        return this.prisma.$transaction(async (tx) => {
            const movement = await tx.inventoryMovement.findUnique({
                where: { id },
                include: { lines: true },
            })
            if (!movement) throw new NotFoundException('Warehouse transfer not found')
            if (movement.status === InventoryMovementStatus.READY) return movement
            if (movement.status !== InventoryMovementStatus.DRAFT) {
                throw new BadRequestException('ONLY_DRAFT_MOVEMENT_CAN_BE_CONFIRMED')
            }
            if (!movement.lines.length) throw new BadRequestException('WAREHOUSE_TRANSFER_REQUIRES_LINES')
            return tx.inventoryMovement.update({
                where: { id },
                data: { status: InventoryMovementStatus.READY, version: { increment: 1 } },
            })
        })
    }

    private async dispatchMovement(id: string) {
        await this.prisma.$transaction(async (tx) => {
            const movement = await tx.inventoryMovement.findUnique({
                where: { id },
                include: {
                    lines: true,
                    dispatches: { where: { status: InventoryDocumentStatus.POSTED } },
                },
            })
            if (!movement) throw new NotFoundException('Warehouse transfer not found')
            if (movement.status === InventoryMovementStatus.IN_TRANSIT && movement.dispatches.length) return
            if (movement.status !== InventoryMovementStatus.READY) {
                throw new BadRequestException('ONLY_READY_MOVEMENT_CAN_BE_DISPATCHED')
            }
            if (!movement.fromWarehouseId) throw new BadRequestException('MOVEMENT_SOURCE_WAREHOUSE_REQUIRED')

            const dispatchedAt = new Date()
            const dispatch = await tx.inventoryDispatch.create({
                data: {
                    dispatchNo: `DSP-${movement.movementNo}-1`,
                    movementId: movement.id,
                    dispatchedAt,
                    lines: {
                        create: movement.lines.map((line) => ({
                            movementLineId: line.id,
                            actualQty: line.plannedActualQty,
                            v15Qty: line.plannedV15Qty,
                        })),
                    },
                },
                include: { lines: { include: { movementLine: true } } },
            })
            await this.inventory.post(tx, {
                postingNo: `POST-${dispatch.dispatchNo}`,
                kind: InventoryPostingKind.MOVEMENT_DISPATCH,
                idempotencyKey: `movement:${movement.id}:dispatch:1`,
                effectiveAt: dispatchedAt,
                source: { movementDispatchId: dispatch.id },
                lines: dispatch.lines.map((line) => ({
                    warehouseId: movement.fromWarehouseId!,
                    productId: line.movementLine.productId,
                    ownerPartyId: line.movementLine.ownerPartyId,
                    inventoryLotId: line.movementLine.inventoryLotId,
                    actualQtyDelta: line.actualQty.negated(),
                    v15QtyDelta: line.v15Qty?.negated() ?? null,
                })),
            })
            await tx.inventoryDispatch.update({
                where: { id: dispatch.id },
                data: { status: InventoryDocumentStatus.POSTED, version: { increment: 1 } },
            })
            await tx.inventoryMovement.update({
                where: { id: movement.id },
                data: { status: InventoryMovementStatus.IN_TRANSIT, version: { increment: 1 } },
            })
        })
        return this.transfer(id)
    }

    private async arriveMovement(id: string, actualArrivalDate?: string) {
        await this.prisma.$transaction(async (tx) => {
            const movement = await tx.inventoryMovement.findUnique({
                where: { id },
                include: {
                    lines: true,
                    arrivals: { where: { status: InventoryDocumentStatus.POSTED } },
                    dispatches: {
                        where: { status: InventoryDocumentStatus.POSTED },
                        include: { lines: { include: { movementLine: true } } },
                    },
                },
            })
            if (!movement) throw new NotFoundException('Warehouse transfer not found')
            if (movement.status === InventoryMovementStatus.COMPLETED && movement.arrivals.length) return
            if (movement.status !== InventoryMovementStatus.IN_TRANSIT) {
                throw new BadRequestException('ONLY_IN_TRANSIT_MOVEMENT_CAN_BE_RECEIVED')
            }
            if (!movement.toWarehouseId) throw new BadRequestException('MOVEMENT_DESTINATION_WAREHOUSE_REQUIRED')
            const dispatch = movement.dispatches[0]
            if (!dispatch) throw new BadRequestException('POSTED_DISPATCH_NOT_FOUND')

            const arrivedAt = actualArrivalDate ? new Date(actualArrivalDate) : new Date()
            const arrival = await tx.inventoryArrival.create({
                data: {
                    arrivalNo: `ARV-${movement.movementNo}-1`,
                    movementId: movement.id,
                    arrivedAt,
                    lines: {
                        create: dispatch.lines.map((line) => ({
                            dispatchLineId: line.id,
                            actualQty: line.actualQty,
                            v15Qty: line.v15Qty,
                        })),
                    },
                },
                include: { lines: { include: { dispatchLine: { include: { movementLine: true } } } } },
            })
            await this.inventory.post(tx, {
                postingNo: `POST-${arrival.arrivalNo}`,
                kind: InventoryPostingKind.MOVEMENT_ARRIVAL,
                idempotencyKey: `movement:${movement.id}:arrival:1`,
                effectiveAt: arrivedAt,
                source: { movementArrivalId: arrival.id },
                lines: arrival.lines.map((line) => ({
                    warehouseId: movement.toWarehouseId!,
                    productId: line.dispatchLine.movementLine.productId,
                    ownerPartyId: line.dispatchLine.movementLine.ownerPartyId,
                    inventoryLotId: line.dispatchLine.movementLine.inventoryLotId,
                    actualQtyDelta: line.actualQty,
                    v15QtyDelta: line.v15Qty,
                })),
            })
            await tx.inventoryArrival.update({
                where: { id: arrival.id },
                data: { status: InventoryDocumentStatus.POSTED, version: { increment: 1 } },
            })
            await tx.expectedSupply.updateMany({
                where: { movementLine: { movementId: movement.id }, status: { not: ExpectedSupplyStatus.CANCELLED } },
                data: {
                    status: ExpectedSupplyStatus.FULFILLED,
                    fulfilledActualQty: 0,
                    version: { increment: 1 },
                },
            })
            for (const line of movement.lines) {
                await tx.expectedSupply.updateMany({
                    where: { movementLineId: line.id, status: ExpectedSupplyStatus.FULFILLED },
                    data: {
                        fulfilledActualQty: line.plannedActualQty,
                        fulfilledV15Qty: line.plannedV15Qty,
                    },
                })
            }
            await tx.inventoryMovement.update({
                where: { id: movement.id },
                data: {
                    status: InventoryMovementStatus.COMPLETED,
                    actualArrivalAt: arrivedAt,
                    version: { increment: 1 },
                },
            })
        })
        return this.transfer(id)
    }

    private async cancelMovement(id: string) {
        await this.prisma.$transaction(async (tx) => {
            const movement = await tx.inventoryMovement.findUnique({ where: { id } })
            if (!movement) throw new NotFoundException('Warehouse transfer not found')
            if (movement.status === InventoryMovementStatus.CANCELLED) return
            if (movement.status !== InventoryMovementStatus.DRAFT && movement.status !== InventoryMovementStatus.READY) {
                throw new BadRequestException('POSTED_MOVEMENT_MUST_BE_REVERSED_INSTEAD_OF_CANCELLED')
            }
            await tx.expectedSupply.updateMany({
                where: { movementLine: { movementId: id }, status: { not: ExpectedSupplyStatus.CANCELLED } },
                data: { status: ExpectedSupplyStatus.CANCELLED, version: { increment: 1 } },
            })
            await tx.inventoryMovement.update({
                where: { id },
                data: { status: InventoryMovementStatus.CANCELLED, version: { increment: 1 } },
            })
        })
        return this.transfer(id)
    }

    async changeTransferStatus(id: string, status: WarehouseTransferStatus, actualArrivalDate?: string) {
        if (status === WarehouseTransferStatus.CONFIRMED) {
            await this.confirmMovement(id)
            return this.transfer(id)
        }
        if (status === WarehouseTransferStatus.IN_TRANSIT) return this.dispatchMovement(id)
        if (status === WarehouseTransferStatus.COMPLETED) return this.arriveMovement(id, actualArrivalDate)
        if (status === WarehouseTransferStatus.CANCELLED) return this.cancelMovement(id)
        if (status === WarehouseTransferStatus.DRAFT) return this.transfer(id)
        throw new BadRequestException('WAREHOUSE_TRANSFER_STATUS_NOT_SUPPORTED')
    }
}
