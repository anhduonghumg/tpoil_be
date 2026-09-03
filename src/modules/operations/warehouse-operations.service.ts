import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
  SalesDeliveryStatus,
} from '@prisma/client';
import { PrismaService } from 'src/infra/prisma/prisma.service';
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service';
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
} from './dto/operations.dto';

@Injectable()
export class WarehouseOperationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: InventoryCoreService,
  ) {}

  private page(q: PageQueryDto) {
    const page = Math.max(Number(q.page ?? 1) || 1, 1);
    const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200);
    return {
      skip: (page - 1) * pageSize,
      take: pageSize,
    };
  }

  async listStorageContracts(q: PageQueryDto) {
    const keyword = q.keyword?.trim();
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
    };
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
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
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
    });
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
    };
    const rowId = await this.prisma.$transaction(async (tx) => {
      const row = id
        ? await tx.storageRentalContract.update({ where: { id }, data })
        : await tx.storageRentalContract.create({ data });
      await tx.storageRentalContractLocation.deleteMany({ where: { contractId: row.id } });
      await tx.storageRentalLossRate.deleteMany({ where: { contractId: row.id } });
      await tx.storageRentalFeeTier.deleteMany({ where: { contractId: row.id } });
      if (dto.supplierLocationIds.length) {
        await tx.storageRentalContractLocation.createMany({
          data: [...new Set(dto.supplierLocationIds)].map((supplierLocationId) => ({
            contractId: row.id,
            supplierLocationId,
          })),
        });
      }
      if (dto.lossRates?.length) {
        await tx.storageRentalLossRate.createMany({
          data: dto.lossRates.map((x) => ({ ...x, contractId: row.id })),
        });
      }
      if (dto.feeTiers?.length) {
        await tx.storageRentalFeeTier.createMany({
          data: dto.feeTiers.map((x, index) => ({
            ...x,
            unit: x.unit || 'VND/LITER',
            sortOrder: x.sortOrder ?? index,
            contractId: row.id,
          })),
        });
      }
      return row.id;
    });
    return this.storageContract(rowId);
  }

  async postStorageTermCost(contractId: string, dto: PostStorageTermCostDto) {
    const contract = await this.prisma.storageRentalContract.findUnique({
      where: { id: contractId },
    });
    if (!contract) throw new NotFoundException('Storage rental contract not found');
    const sourceType = dto.costType === 'LOSS' ? 'STORAGE_LOSS' : 'STORAGE_RENTAL';
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.termLogisticsCostLine.findUnique({
        where: {
          operationsSourceType_operationsSourceId: {
            operationsSourceType: sourceType,
            operationsSourceId: dto.purchaseOrderId,
          },
        },
      });
      if (existing) return existing;
      const amount = new Prisma.Decimal(dto.amountVnd);
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
      });
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
      });
    });
  }

  private async warehouseContext(
    tx: Prisma.TransactionClient | PrismaService,
    warehouseId: string,
  ) {
    const warehouse = await tx.warehouse.findUnique({
      where: { id: warehouseId },
      select: { id: true, legalEntityId: true, legalEntity: { select: { partyId: true } } },
    });
    if (!warehouse) throw new NotFoundException('Warehouse not found');
    return warehouse;
  }

  private async ownerPartyId(
    tx: Prisma.TransactionClient | PrismaService,
    warehouseId: string,
    ownerType: WarehouseOwnerType,
    ownerCustomerId?: string | null,
  ) {
    if (ownerType !== WarehouseOwnerType.INTERNAL) {
      if (!ownerCustomerId) throw new BadRequestException('OWNER_PARTY_REQUIRED');
      return ownerCustomerId;
    }
    if (ownerCustomerId) throw new BadRequestException('INTERNAL_OWNER_MUST_NOT_HAVE_CUSTOMER_ID');
    return (await this.warehouseContext(tx, warehouseId)).legalEntity.partyId;
  }

  private oldOwner(ownerPartyId: string, legalEntityPartyId: string) {
    return ownerPartyId === legalEntityPartyId
      ? { ownerType: WarehouseOwnerType.INTERNAL, ownerCustomerId: null }
      : { ownerType: WarehouseOwnerType.CUSTOMER, ownerCustomerId: ownerPartyId };
  }

  async listAvailability(
    q: PageQueryDto & {
      supplierLocationId?: string;
      productId?: string;
      ownerType?: WarehouseOwnerType;
    },
  ) {
    const where: Prisma.InventoryAvailabilityBalanceWhereInput = {
      ...(q.supplierLocationId ? { warehouseId: q.supplierLocationId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      ...(q.ownerType === WarehouseOwnerType.INTERNAL
        ? { owner: { legalEntities: { some: {} } } }
        : q.ownerType
          ? { owner: { legalEntities: { none: {} } } }
          : {}),
    };
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
              areaId: true,
              area: { select: { id: true, code: true, name: true } },
              legalEntity: { select: { partyId: true } },
            },
          },
          product: { select: { id: true, code: true, name: true, uom: true } },
          owner: { select: { id: true, code: true, name: true } },
        },
      }),
      this.prisma.inventoryAvailabilityBalance.count({ where }),
    ]);
    const stockRows = items.length
      ? await this.prisma.stockBalance.findMany({
          where: {
            OR: items.map((item) => ({
              warehouseId: item.warehouseId,
              productId: item.productId,
              ownerPartyId: item.ownerPartyId,
            })),
            actualQty: { not: new Prisma.Decimal(0) },
          },
          select: {
            inventoryLotId: true,
            warehouseId: true,
            productId: true,
            ownerPartyId: true,
            actualQty: true,
            lot: {
              select: {
                releaseCode: true,
                receivedAt: true,
                supplierPartyId: true,
                supplier: { select: { id: true, code: true, name: true } },
              },
            },
          },
        })
      : [];
    const lotIds = stockRows.map((row) => row.inventoryLotId);
    const [reservedByLotRows, pendingByLotRows, blockedByLotRows, expectedRows] = await Promise.all(
      [
        lotIds.length
          ? this.prisma.inventoryReservationLine.groupBy({
              by: ['inventoryLotId'],
              where: { inventoryLotId: { in: lotIds }, activeActualQty: { gt: 0 } },
              _sum: { activeActualQty: true },
            })
          : [],
        lotIds.length
          ? this.prisma.inventoryPendingRelease.groupBy({
              by: ['inventoryLotId'],
              where: {
                inventoryLotId: { in: lotIds },
                status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                activeActualQty: { gt: 0 },
              },
              _sum: { activeActualQty: true },
            })
          : [],
        lotIds.length
          ? this.prisma.inventoryBlock.groupBy({
              by: ['inventoryLotId'],
              where: {
                inventoryLotId: { in: lotIds },
                status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
                activeActualQty: { gt: 0 },
              },
              _sum: { activeActualQty: true },
            })
          : [],
        this.prisma.expectedSupply.findMany({
          where: {
            status: { in: ['OPEN', 'PARTIALLY_FULFILLED'] },
            purchaseOrderLine: { purchaseOrder: { orderType: { not: 'LOT' } } },
            ...(q.supplierLocationId ? { warehouseId: q.supplierLocationId } : {}),
            ...(q.productId ? { productId: q.productId } : {}),
          },
          include: {
            warehouse: {
              select: {
                id: true,
                code: true,
                name: true,
                areaId: true,
                area: { select: { id: true, code: true, name: true } },
              },
            },
            warehouseArea: { select: { id: true, code: true, name: true } },
            product: { select: { id: true, code: true, name: true, uom: true } },
            purchaseOrderLine: {
              select: {
                purchaseOrder: {
                  select: {
                    orderNo: true,
                    releaseCode: true,
                    supplier: { select: { id: true, code: true, name: true } },
                  },
                },
              },
            },
          },
          orderBy: [{ expectedAt: 'asc' }, { expectedNo: 'asc' }],
        }),
      ],
    );
    const decimalMap = (
      rows: Array<{
        inventoryLotId: string | null;
        _sum: { activeActualQty: Prisma.Decimal | null };
      }>,
    ) =>
      new Map(
        rows
          .filter((row): row is typeof row & { inventoryLotId: string } => !!row.inventoryLotId)
          .map((row) => [row.inventoryLotId, new Prisma.Decimal(row._sum.activeActualQty ?? 0)]),
      );
    const reservedByLot = decimalMap(reservedByLotRows);
    const pendingByLot = decimalMap(pendingByLotRows);
    const blockedByLot = decimalMap(blockedByLotRows);
    const availabilityByKey = new Map(
      items.map((item) => [`${item.warehouseId}:${item.productId}:${item.ownerPartyId}`, item]),
    );
    const physicalMatrixItems = stockRows.map((stock) => {
      const availability = availabilityByKey.get(
        `${stock.warehouseId}:${stock.productId}:${stock.ownerPartyId}`,
      )!;
      const unavailableQty = Prisma.Decimal.min(
        stock.actualQty,
        (reservedByLot.get(stock.inventoryLotId) ?? new Prisma.Decimal(0))
          .plus(pendingByLot.get(stock.inventoryLotId) ?? 0)
          .plus(blockedByLot.get(stock.inventoryLotId) ?? 0),
      );
      return {
        id: `physical:${stock.inventoryLotId}:${stock.warehouseId}`,
        source: 'PHYSICAL',
        supplierLocationId: stock.warehouseId,
        supplierLocation: availability.warehouse,
        supplierLocationType: 'WAREHOUSE',
        supplierLocationAreaId: availability.warehouse.areaId,
        supplierLocationArea: availability.warehouse.area,
        supplier: stock.lot.supplier,
        product: availability.product,
        releaseCode: stock.lot.releaseCode,
        inventoryLotId: stock.inventoryLotId,
        receivedAt: stock.lot.receivedAt,
        actualQty: stock.actualQty,
        sellableQty: Prisma.Decimal.max(stock.actualQty.minus(unavailableQty), 0),
        heldQty: unavailableQty,
        expectedQty: new Prisma.Decimal(0),
      };
    });
    const expectedMatrixItems = expectedRows
      .map((expected) => {
        const qty = Prisma.Decimal.max(
          expected.expectedActualQty.minus(expected.fulfilledActualQty),
          0,
        );
        if (!qty.greaterThan(0)) return null;
        const order = expected.purchaseOrderLine!.purchaseOrder;
        const location = expected.warehouse ?? expected.warehouseArea;
        if (!location) return null;
        return {
          id: `expected:${expected.id}`,
          source: 'EXPECTED',
          supplierLocationId: location.id,
          supplierLocation: location,
          supplierLocationType: expected.warehouse ? 'WAREHOUSE' : 'AREA',
          supplierLocationAreaId: expected.warehouse?.areaId ?? expected.warehouseAreaId,
          supplierLocationArea: expected.warehouse?.area ?? expected.warehouseArea,
          supplier: order.supplier,
          product: expected.product,
          releaseCode: order.releaseCode,
          orderNo: order.orderNo,
          actualQty: new Prisma.Decimal(0),
          sellableQty: new Prisma.Decimal(0),
          heldQty: new Prisma.Decimal(0),
          expectedQty: qty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
    const releaseTotalsByAvailability = new Map<
      string,
      { TP: Prisma.Decimal; NCC: Prisma.Decimal; UNCLASSIFIED: Prisma.Decimal }
    >();
    const supplierTotalsByAvailability = new Map<
      string,
      Map<
        string,
        {
          supplier: { id: string; code: string; name: string };
          TP: Prisma.Decimal;
          NCC: Prisma.Decimal;
          UNCLASSIFIED: Prisma.Decimal;
        }
      >
    >();
    for (const stock of stockRows) {
      const key = `${stock.warehouseId}:${stock.productId}:${stock.ownerPartyId}`;
      const totals = releaseTotalsByAvailability.get(key) ?? {
        TP: new Prisma.Decimal(0),
        NCC: new Prisma.Decimal(0),
        UNCLASSIFIED: new Prisma.Decimal(0),
      };
      const releaseCode = stock.lot.releaseCode ?? 'UNCLASSIFIED';
      totals[releaseCode] = totals[releaseCode].plus(stock.actualQty);
      releaseTotalsByAvailability.set(key, totals);
      if (stock.lot.supplier) {
        const suppliers = supplierTotalsByAvailability.get(key) ?? new Map();
        const supplierTotals = suppliers.get(stock.lot.supplier.id) ?? {
          supplier: stock.lot.supplier,
          TP: new Prisma.Decimal(0),
          NCC: new Prisma.Decimal(0),
          UNCLASSIFIED: new Prisma.Decimal(0),
        };
        supplierTotals[releaseCode] = supplierTotals[releaseCode].plus(stock.actualQty);
        suppliers.set(stock.lot.supplier.id, supplierTotals);
        supplierTotalsByAvailability.set(key, suppliers);
      }
    }
    return {
      matrixItems: [...physicalMatrixItems, ...expectedMatrixItems],
      items: items.map((item) => {
        const availableQty = new Prisma.Decimal(item.onHandActualQty)
          .minus(item.pendingActualQty)
          .minus(item.blockedActualQty);
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
          releaseTotals: releaseTotalsByAvailability.get(
            `${item.warehouseId}:${item.productId}:${item.ownerPartyId}`,
          ) ?? {
            TP: new Prisma.Decimal(0),
            NCC: new Prisma.Decimal(0),
            UNCLASSIFIED: new Prisma.Decimal(0),
          },
          supplierReleaseTotals: [
            ...(supplierTotalsByAvailability
              .get(`${item.warehouseId}:${item.productId}:${item.ownerPartyId}`)
              ?.values() ?? []),
          ],
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async inventoryMatrix(q: PageQueryDto & { supplierLocationId?: string; productId?: string }) {
    const availability = await this.listAvailability(q);
    const accounting = await this.prisma.$queryRaw<any[]>(Prisma.sql`
      SELECT
        CONCAT('accounting:', COALESCE(w.id, direct_area.id), ':', e."productId", ':', e."supplierPartyId", ':', e."releaseCode") AS id,
        COALESCE(w.id, direct_area.id) AS "supplierLocationId",
        CASE WHEN w.id IS NULL THEN 'AREA' ELSE 'WAREHOUSE' END AS "supplierLocationType",
        jsonb_build_object(
          'id', COALESCE(w.id, direct_area.id),
          'code', COALESCE(w.code, direct_area.code),
          'name', COALESCE(w.name, direct_area.name)
        ) AS "supplierLocation",
        COALESCE(w."areaId", direct_area.id) AS "supplierLocationAreaId",
        jsonb_build_object(
          'id', COALESCE(warehouse_area.id, direct_area.id),
          'code', COALESCE(warehouse_area.code, direct_area.code),
          'name', COALESCE(warehouse_area.name, direct_area.name)
        ) AS "supplierLocationArea",
        jsonb_build_object('id', product.id, 'code', product.code, 'name', product.name, 'uom', product.uom) AS product,
        e."productId",
        jsonb_build_object('id', supplier.id, 'code', supplier.code, 'name', supplier.name) AS supplier,
        e."supplierPartyId",
        e."releaseCode",
        SUM(e."qtyDelta") AS "accountingQty",
        SUM(e."valueDelta") AS "accountingValue"
      FROM "AccountingInventoryEntry" e
      LEFT JOIN "Warehouse" w ON w.id = e."warehouseId"
      LEFT JOIN "WarehouseArea" warehouse_area ON warehouse_area.id = w."areaId"
      LEFT JOIN "WarehouseArea" direct_area ON direct_area.id = e."warehouseAreaId"
      JOIN "Product" product ON product.id = e."productId"
      JOIN "Party" supplier ON supplier.id = e."supplierPartyId"
      WHERE 1 = 1
        ${q.supplierLocationId ? Prisma.sql`AND (e."warehouseId" = ${q.supplierLocationId}::uuid OR e."warehouseAreaId" = ${q.supplierLocationId}::uuid)` : Prisma.empty}
        ${q.productId ? Prisma.sql`AND e."productId" = ${q.productId}::uuid` : Prisma.empty}
      GROUP BY
        w.id, w.code, w.name, w."areaId",
        warehouse_area.id, warehouse_area.code, warehouse_area.name,
        direct_area.id, direct_area.code, direct_area.name,
        product.id, product.code, product.name, product.uom,
        supplier.id, supplier.code, supplier.name,
        e."productId", e."supplierPartyId", e."releaseCode"
      HAVING SUM(e."qtyDelta") <> 0 OR SUM(e."valueDelta") <> 0
      ORDER BY
        COALESCE(warehouse_area.name, direct_area.name),
        COALESCE(w.name, direct_area.name), supplier.code, product.code, e."releaseCode"
    `);
    return {
      availability,
      accounting: accounting.map((item) => ({ ...item, source: 'ACCOUNTING_LEDGER' })),
    };
  }

  async listCommercialLotInventory(
    q: PageQueryDto & { supplierLocationId?: string; areaId?: string; productId?: string },
  ) {
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
                        withdrawal: { status: CommercialLotWithdrawalStatus.CONFIRMED },
                        destinationWarehouseId: q.supplierLocationId,
                      },
                    },
                  },
                ],
              }
            : {}),
          ...(q.areaId
            ? {
                OR: [
                  { plannedWarehouseAreaId: q.areaId },
                  { plannedWarehouse: { areaId: q.areaId } },
                  {
                    withdrawalLines: {
                      some: {
                        withdrawal: { status: CommercialLotWithdrawalStatus.CONFIRMED },
                        destinationWarehouse: { areaId: q.areaId },
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
          plannedWarehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              area: { select: { id: true, code: true, name: true } },
            },
          },
          plannedWarehouseArea: { select: { id: true, code: true, name: true } },
          product: { select: { id: true, code: true, name: true, uom: true } },
          purchaseOrderLine: {
            select: {
              purchaseOrder: { select: { id: true, orderNo: true, releaseCode: true } },
            },
          },
          withdrawalLines: {
            where: { withdrawal: { status: CommercialLotWithdrawalStatus.CONFIRMED } },
            select: {
              actualQty: true,
              destinationWarehouse: {
                select: {
                  id: true,
                  code: true,
                  name: true,
                  area: { select: { id: true, code: true, name: true } },
                },
              },
            },
          },
        },
        orderBy: [
          { plannedWarehouseArea: { name: 'asc' } },
          { plannedWarehouse: { name: 'asc' } },
          { supplier: { name: 'asc' } },
          { product: { name: 'asc' } },
        ],
      }),
      this.prisma.purchaseOrderLine.findMany({
        where: {
          ...(q.supplierLocationId ? { receivingWarehouseId: q.supplierLocationId } : {}),
          ...(q.areaId
            ? {
                OR: [
                  { plannedReceivingAreaId: q.areaId },
                  { receivingWarehouse: { areaId: q.areaId } },
                ],
              }
            : {}),
          ...(q.productId ? { productId: q.productId } : {}),
          purchaseOrder: {
            orderType: 'LOT',
            bizType: 'COMMERCIAL',
            status: { in: ['DRAFT', 'APPROVED', 'IN_PROGRESS'] },
          },
        },
        include: {
          product: { select: { id: true, code: true, name: true, uom: true } },
          receivingWarehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              area: { select: { id: true, code: true, name: true } },
            },
          },
          plannedReceivingArea: { select: { id: true, code: true, name: true } },
          commercialLotPosition: { select: { invoicedQty: true } },
          purchaseOrder: {
            select: {
              id: true,
              orderNo: true,
              releaseCode: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
        },
        orderBy: [
          { plannedReceivingArea: { name: 'asc' } },
          { receivingWarehouse: { name: 'asc' } },
          { purchaseOrder: { supplier: { name: 'asc' } } },
          { product: { name: 'asc' } },
        ],
      }),
    ]);

    const invoiceRows = positions.flatMap((position) => {
      const plannedKey = position.plannedWarehouseId
        ? `warehouse:${position.plannedWarehouseId}`
        : `area:${position.plannedWarehouseAreaId}`;
      const allocatedByLocation = new Map<
        string,
        {
          locationType: 'WAREHOUSE' | 'AREA';
          location:
            | NonNullable<typeof position.plannedWarehouse>
            | NonNullable<typeof position.plannedWarehouseArea>;
          area: { id: string; code: string; name: string };
          /** Lượng tính vào tồn kế toán của sổ lô. */
          qty: Prisma.Decimal;
          /** Phần còn nằm ở sổ lô; phần đã rút đã thành lô kho thật nên bằng 0. */
          stockQty: Prisma.Decimal;
        }
      >();
      const plannedQty = Prisma.Decimal.max(position.invoicedQty.minus(position.withdrawnQty), 0);
      if (position.plannedWarehouse) {
        allocatedByLocation.set(plannedKey, {
          locationType: 'WAREHOUSE',
          location: position.plannedWarehouse,
          area: position.plannedWarehouse.area ?? {
            id: `unassigned:${position.plannedWarehouse.id}`,
            code: 'UNASSIGNED',
            name: 'Chưa gán khu vực',
          },
          qty: plannedQty,
          stockQty: plannedQty,
        });
      } else if (position.plannedWarehouseArea) {
        allocatedByLocation.set(plannedKey, {
          locationType: 'AREA',
          location: position.plannedWarehouseArea,
          area: position.plannedWarehouseArea,
          qty: plannedQty,
          stockQty: plannedQty,
        });
      }

      // Xác nhận rút lô đã ghi thẳng vào sổ kho (lô kho mang mã NCC + mã rút), nên
      // phần đã rút chỉ còn xuất hiện ở đây để giữ tồn kế toán của sổ lô. Cộng nó vào
      // tồn thực tế nữa sẽ đếm hai lần cùng một lượng hàng.
      for (const withdrawalLine of position.withdrawalLines) {
        const destination = withdrawalLine.destinationWarehouse;

        const destinationKey = `warehouse:${destination.id}`;
        const existing = allocatedByLocation.get(destinationKey);
        if (existing) {
          existing.qty = existing.qty.plus(withdrawalLine.actualQty);
          continue;
        }

        allocatedByLocation.set(destinationKey, {
          locationType: 'WAREHOUSE',
          location: destination,
          area: destination.area ?? {
            id: `unassigned:${destination.id}`,
            code: 'UNASSIGNED',
            name: 'Chưa gán khu vực',
          },
          qty: new Prisma.Decimal(withdrawalLine.actualQty),
          stockQty: new Prisma.Decimal(0),
        });
      }
      const isExportable = position.stockState === 'EXPORTABLE';

      return [...allocatedByLocation.entries()]
        .filter(([, allocation]) => allocation.qty.greaterThan(0))
        .map(([locationKey, allocation]) => {
          const accountingValue = position.invoicedQty.isZero()
            ? new Prisma.Decimal(0)
            : position.accountingValue.mul(allocation.qty).div(position.invoicedQty);
          return {
            id: `commercial-lot:${position.id}:${locationKey}`,
            source: 'COMMERCIAL_LOT',
            includeInAccounting: true,
            commercialLotPositionId: position.id,
            supplierLocationId: allocation.location.id,
            supplierLocation: allocation.location,
            supplierLocationType: allocation.locationType,
            supplierLocationAreaId: allocation.area.id,
            supplierLocationArea: allocation.area,
            supplier: position.supplier,
            product: position.product,
            orderNo: position.purchaseOrderLine.purchaseOrder.orderNo,
            releaseCode:
              position.releaseCode ?? position.purchaseOrderLine.purchaseOrder.releaseCode,
            stockState: position.stockState,
            accountingQty: allocation.qty,
            accountingValue,
            actualQty: allocation.stockQty,
            sellableQty: isExportable ? allocation.stockQty : new Prisma.Decimal(0),
            heldQty: isExportable ? new Prisma.Decimal(0) : allocation.stockQty,
            expectedQty: new Prisma.Decimal(0),
            exportableQty: isExportable ? allocation.stockQty : new Prisma.Decimal(0),
            temporaryExportQty: new Prisma.Decimal(0),
            nonExportableQty: !isExportable ? allocation.stockQty : new Prisma.Decimal(0),
          };
        });
    });

    const pendingOrderRows = pendingOrderLines
      .map((line) => {
        const invoicedQty = line.commercialLotPosition?.invoicedQty ?? new Prisma.Decimal(0);
        const expectedQty = line.actualReceivedQty ?? line.orderedQty;
        const pendingInvoiceQty = expectedQty.minus(invoicedQty);
        if (pendingInvoiceQty.lessThanOrEqualTo(0)) return null;

        return {
          id: `commercial-lot-order:${line.id}`,
          source: 'COMMERCIAL_LOT_ORDER',
          includeInAccounting: false,
          purchaseOrderLineId: line.id,
          supplierLocationId: line.receivingWarehouseId ?? line.plannedReceivingAreaId,
          supplierLocation: line.receivingWarehouse ?? line.plannedReceivingArea,
          supplierLocationType: line.receivingWarehouseId ? 'WAREHOUSE' : 'AREA',
          supplierLocationAreaId: line.receivingWarehouse?.area?.id ?? line.plannedReceivingAreaId,
          supplierLocationArea: line.receivingWarehouse?.area ?? line.plannedReceivingArea,
          supplier: line.purchaseOrder.supplier,
          product: line.product,
          orderNo: line.purchaseOrder.orderNo,
          releaseCode: line.purchaseOrder.releaseCode,
          stockState: 'EXPECTED',
          accountingQty: new Prisma.Decimal(0),
          accountingValue: new Prisma.Decimal(0),
          actualQty: new Prisma.Decimal(0),
          sellableQty: new Prisma.Decimal(0),
          heldQty: new Prisma.Decimal(0),
          expectedQty: pendingInvoiceQty,
          exportableQty: new Prisma.Decimal(0),
          temporaryExportQty: new Prisma.Decimal(0),
          nonExportableQty: pendingInvoiceQty,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    const rows = [...invoiceRows, ...pendingOrderRows];

    const page = Math.max(Number(q.page ?? 1) || 1, 1);
    const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200);
    return {
      items: rows.slice((page - 1) * pageSize, page * pageSize),
      total: rows.length,
      page,
      pageSize,
    };
  }

  /** Lượng tồn đang giữ theo khách hàng, vẫn giữ nguyên NCC và mã rút của từng lô. */
  async listCustomerHeldInventory(
    q: PageQueryDto & {
      supplierLocationId?: string;
      customerPartyId?: string;
      productId?: string;
    },
  ) {
    const where: Prisma.InventoryReservationLineWhereInput = {
      activeActualQty: { gt: 0 },
      inventoryLotId: { not: null },
      salesOrderLineId: { not: null },
      ...(q.supplierLocationId ? { warehouseId: q.supplierLocationId } : {}),
      ...(q.productId ? { productId: q.productId } : {}),
      reservation: {
        customerPartyId: q.customerPartyId ?? { not: null },
        status: {
          in: [
            ReservationStatus.DRAFT,
            ReservationStatus.ACTIVE,
            ReservationStatus.PARTIALLY_RELEASED,
          ],
        },
      },
    };
    const page = Math.max(Number(q.page ?? 1) || 1, 1);
    const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 500);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.inventoryReservationLine.findMany({
        where,
        orderBy: [
          { warehouse: { name: 'asc' } },
          { reservation: { customer: { code: 'asc' } } },
          { product: { code: 'asc' } },
          { lot: { receivedAt: 'asc' } },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          warehouse: {
            select: {
              id: true,
              code: true,
              name: true,
              areaId: true,
              area: { select: { id: true, code: true, name: true } },
            },
          },
          product: { select: { id: true, code: true, name: true, uom: true } },
          lot: {
            select: {
              id: true,
              lotNo: true,
              receivedAt: true,
              releaseCode: true,
              supplier: { select: { id: true, code: true, name: true } },
            },
          },
          reservation: {
            select: {
              customer: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      this.prisma.inventoryReservationLine.count({ where }),
    ]);
    return {
      items: rows.map((row) => ({
        id: `customer-hold:${row.id}`,
        source: 'CUSTOMER_HOLD',
        supplierLocationId: row.warehouseId,
        supplierLocation: row.warehouse,
        supplierLocationType: 'WAREHOUSE',
        supplierLocationAreaId: row.warehouse.areaId,
        supplierLocationArea: row.warehouse.area,
        customer: row.reservation.customer,
        supplier: row.lot?.supplier,
        product: row.product,
        releaseCode: row.lot?.releaseCode,
        inventoryLotId: row.lot?.id,
        lotNo: row.lot?.lotNo,
        actualQty: new Prisma.Decimal(0),
        sellableQty: new Prisma.Decimal(0),
        heldQty: row.activeActualQty,
        expectedQty: new Prisma.Decimal(0),
      })),
      total,
      page,
      pageSize,
    };
  }

  private async activeWarehouseLocation(
    tx: Prisma.TransactionClient | PrismaService,
    areaId: string,
    warehouseId?: string | null,
  ) {
    const area = await tx.warehouseArea.findFirst({
      where: { id: areaId, status: MasterStatus.ACTIVE },
      select: { id: true, code: true, name: true },
    });
    if (!area) throw new BadRequestException('WAREHOUSE_AREA_INVALID');
    if (!warehouseId) return { area, warehouse: null };
    const warehouse = await tx.warehouse.findFirst({
      where: { id: warehouseId, areaId, status: MasterStatus.ACTIVE, isOperationalWarehouse: true },
      select: { id: true, code: true, name: true, legalEntityId: true, areaId: true },
    });
    if (!warehouse) throw new BadRequestException('WAREHOUSE_NOT_IN_SELECTED_AREA');
    return { area, warehouse };
  }

  private async expectedSource(
    tx: Prisma.TransactionClient,
    dto: CreateExpectedInventoryDto,
  ): Promise<
    Pick<
      Prisma.ExpectedSupplyUncheckedCreateInput,
      'purchaseOrderLineId' | 'movementLineId' | 'manualReference'
    >
  > {
    if (dto.sourceType === 'WAREHOUSE_TRANSFER') {
      const line = await tx.inventoryMovementLine.findFirst({
        where: { movementId: dto.sourceId, productId: dto.productId },
        select: { id: true },
      });
      if (!line) throw new BadRequestException('MOVEMENT_LINE_NOT_FOUND');
      return { movementLineId: line.id };
    }
    if (dto.sourceType === 'PURCHASE_ORDER' || dto.sourceType === 'SHIP_CHARTER_ORDER') {
      let purchaseOrderId = dto.sourceId;
      if (dto.sourceType === 'SHIP_CHARTER_ORDER') {
        const charter = await tx.shipCharterOrder.findUnique({
          where: { id: dto.sourceId },
          select: { purchaseOrderId: true },
        });
        if (!charter?.purchaseOrderId)
          throw new BadRequestException('SHIP_CHARTER_PURCHASE_ORDER_NOT_FOUND');
        purchaseOrderId = charter.purchaseOrderId;
      }
      const line = await tx.purchaseOrderLine.findFirst({
        where: { purchaseOrderId, productId: dto.productId },
        select: { id: true },
      });
      if (!line) throw new BadRequestException('PURCHASE_ORDER_LINE_NOT_FOUND');
      return { purchaseOrderLineId: line.id };
    }
    return { manualReference: `MANUAL:${dto.sourceId}` };
  }

  private async expectedOwnerPartyId(
    tx: Prisma.TransactionClient,
    dto: CreateExpectedInventoryDto,
    source: Pick<
      Prisma.ExpectedSupplyUncheckedCreateInput,
      'purchaseOrderLineId' | 'movementLineId' | 'manualReference'
    >,
  ) {
    if (dto.ownerType !== WarehouseOwnerType.INTERNAL) {
      if (!dto.ownerCustomerId) throw new BadRequestException('OWNER_PARTY_REQUIRED');
      return dto.ownerCustomerId;
    }
    if (dto.ownerCustomerId)
      throw new BadRequestException('INTERNAL_OWNER_MUST_NOT_HAVE_CUSTOMER_ID');
    if (dto.supplierLocationId) {
      return (await this.warehouseContext(tx, dto.supplierLocationId)).legalEntity.partyId;
    }
    if (source.purchaseOrderLineId) {
      const line = await tx.purchaseOrderLine.findUnique({
        where: { id: source.purchaseOrderLineId },
        select: { purchaseOrder: { select: { legalEntity: { select: { partyId: true } } } } },
      });
      if (line) return line.purchaseOrder.legalEntity.partyId;
    }
    if (source.movementLineId) {
      const line = await tx.inventoryMovementLine.findUnique({
        where: { id: source.movementLineId },
        select: { ownerPartyId: true },
      });
      if (line) return line.ownerPartyId;
    }
    const legalEntity = await tx.legalEntity.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { partyId: true },
    });
    if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_REQUIRED');
    return legalEntity.partyId;
  }

  async createExpected(dto: CreateExpectedInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      await this.activeWarehouseLocation(tx, dto.warehouseAreaId, dto.supplierLocationId);
      const source = await this.expectedSource(tx, dto);
      const ownerPartyId = await this.expectedOwnerPartyId(tx, dto, source);
      const locationKey = dto.supplierLocationId ?? `AREA-${dto.warehouseAreaId}`;
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
      });
    });
  }

  async listExpected(q: PageQueryDto) {
    const status = q.status
      ? q.status === 'PARTIALLY_RECEIVED'
        ? ExpectedSupplyStatus.PARTIALLY_FULFILLED
        : q.status === 'RECEIVED'
          ? ExpectedSupplyStatus.FULFILLED
          : (q.status as ExpectedSupplyStatus)
      : undefined;
    const where: Prisma.ExpectedSupplyWhereInput = { ...(status ? { status } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.expectedSupply.findMany({
        where,
        ...this.page(q),
        orderBy: [{ expectedAt: 'asc' }, { expectedNo: 'desc' }],
        include: { warehouseArea: true, warehouse: true, product: true, owner: true },
      }),
      this.prisma.expectedSupply.count({ where }),
    ]);
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
    };
  }

  async allocateExpected(id: string, dto: AllocateExpectedInventoryDto) {
    return this.prisma.$transaction(async (tx) => {
      const supply = await tx.expectedSupply.findUnique({ where: { id } });
      if (!supply) throw new NotFoundException('Expected supply not found');
      if (
        supply.status !== ExpectedSupplyStatus.OPEN &&
        supply.status !== ExpectedSupplyStatus.PARTIALLY_FULFILLED
      ) {
        throw new BadRequestException('Expected supply is not open');
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
      });
      if (!receiptLine) throw new BadRequestException('MATCHING_RECEIPT_LINE_NOT_FOUND');
      const existing = await tx.expectedSupplyAllocation.findUnique({
        where: {
          expectedSupplyId_receiptLineId: { expectedSupplyId: id, receiptLineId: receiptLine.id },
        },
      });
      if (existing) return existing;
      const allocated = new Prisma.Decimal(dto.allocatedQty);
      const remaining = new Prisma.Decimal(supply.expectedActualQty).minus(
        supply.fulfilledActualQty,
      );
      if (allocated.greaterThan(remaining) || allocated.greaterThan(receiptLine.actualQty)) {
        throw new BadRequestException('Allocated quantity exceeds remainder');
      }
      const allocation = await tx.expectedSupplyAllocation.create({
        data: {
          expectedSupplyId: id,
          receiptLineId: receiptLine.id,
          actualQty: allocated,
          idempotencyKey: `expected:${id}:receipt-line:${receiptLine.id}`,
        },
      });
      const fulfilledActualQty = new Prisma.Decimal(supply.fulfilledActualQty).plus(allocated);
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
      });
      return allocation;
    });
  }

  async cancelExpected(id: string) {
    const row = await this.prisma.expectedSupply.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Expected supply not found');
    if (row.status === ExpectedSupplyStatus.FULFILLED) {
      throw new BadRequestException('Fulfilled expectation cannot be cancelled');
    }
    if (row.status === ExpectedSupplyStatus.CANCELLED) return row;
    return this.prisma.expectedSupply.update({
      where: { id },
      data: { status: ExpectedSupplyStatus.CANCELLED, version: { increment: 1 } },
    });
  }

  private reservationStatus(status?: string): ReservationStatus | undefined {
    if (!status) return undefined;
    return status as ReservationStatus;
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
    };
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
    ]);
    return {
      items: rows.map((row) => {
        const line = row.lines[0];
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
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async createReservation(dto: CreateWarehouseReservationDto) {
    return this.prisma.$transaction(async (tx) => {
      const warehouse = await this.warehouseContext(tx, dto.supplierLocationId);
      const existing = await tx.inventoryReservation.findUnique({
        where: { reservationNo: dto.reservationNo.trim() },
        include: { lines: true },
      });
      if (existing) return existing;

      let customerPartyId = dto.customerId ?? null;
      let salesOrderId: string | null = null;
      let manualReference: string | null = null;
      if (dto.sourceType === WarehouseReservationSourceType.SALES_ORDER) {
        if (!dto.sourceId) {
          throw new BadRequestException('RESERVATION_SALES_ORDER_REQUIRED');
        }
        const salesOrder = await tx.salesOrder.findUnique({
          where: { id: dto.sourceId },
          select: { id: true, legalEntityId: true, customerPartyId: true },
        });
        if (!salesOrder) throw new NotFoundException('Sales order not found');
        if (salesOrder.legalEntityId !== warehouse.legalEntityId) {
          throw new BadRequestException('RESERVATION_SALES_ORDER_LEGAL_ENTITY_MISMATCH');
        }
        if (customerPartyId && customerPartyId !== salesOrder.customerPartyId) {
          throw new BadRequestException('RESERVATION_SALES_ORDER_CUSTOMER_MISMATCH');
        }
        salesOrderId = salesOrder.id;
        customerPartyId = salesOrder.customerPartyId;
      } else {
        manualReference = dto.sourceId ?? dto.reservationNo.trim();
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
      });
      await this.inventory.activateReservationLine(tx, {
        reservationLineId: reservation.lines[0].id,
        actualQty: dto.reservedQty,
        idempotencyKey: `reservation:${reservation.id}:activate:1`,
        occurredAt: reservation.reservedAt,
        reason: dto.note,
      });
      return tx.inventoryReservation.findUniqueOrThrow({
        where: { id: reservation.id },
        include: { lines: true },
      });
    });
  }

  async changeReservation(id: string, requestedStatus: WarehouseReservationStatus) {
    const target = requestedStatus as unknown as ReservationStatus;
    if (target === ReservationStatus.ACTIVE) {
      return this.prisma.inventoryReservation.findUniqueOrThrow({
        where: { id },
        include: { lines: true },
      });
    }
    if (
      target !== ReservationStatus.RELEASED &&
      target !== ReservationStatus.CANCELLED &&
      target !== ReservationStatus.CONSUMED
    ) {
      throw new BadRequestException('RESERVATION_STATUS_TRANSITION_NOT_SUPPORTED');
    }
    return this.prisma.$transaction(async (tx) => {
      const reservation = await tx.inventoryReservation.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!reservation) throw new NotFoundException('Reservation not found');
      if (reservation.status === target) return reservation;
      if (
        reservation.status !== ReservationStatus.ACTIVE &&
        reservation.status !== ReservationStatus.PARTIALLY_RELEASED
      ) {
        throw new BadRequestException('RESERVATION_IS_NOT_ACTIVE');
      }
      for (const line of reservation.lines) {
        if (!line.activeActualQty.isPositive()) continue;
        const args = {
          reservationLineId: line.id,
          actualQty: line.activeActualQty,
          v15Qty: line.activeV15Qty,
          idempotencyKey: `reservation:${reservation.id}:${target.toLowerCase()}:${line.lineNo}`,
          occurredAt: new Date(),
          reason: `Chuyển trạng thái phiếu giữ hàng sang ${target}`,
        };
        if (target === ReservationStatus.CONSUMED) {
          await this.inventory.consumeReservationLine(tx, args);
        } else {
          await this.inventory.releaseReservationLine(tx, args);
        }
      }
      return tx.inventoryReservation.update({
        where: { id },
        data: { status: target, version: { increment: 1 } },
        include: { lines: true },
      });
    });
  }

  private movementStatus(status?: string): InventoryMovementStatus | undefined {
    if (!status) return undefined;
    if (status === WarehouseTransferStatus.CONFIRMED) return InventoryMovementStatus.READY;
    return status as InventoryMovementStatus;
  }

  private transferStatus(status: InventoryMovementStatus): WarehouseTransferStatus {
    if (status === InventoryMovementStatus.READY) return WarehouseTransferStatus.CONFIRMED;
    if (status === InventoryMovementStatus.PARTIALLY_ARRIVED)
      return WarehouseTransferStatus.IN_TRANSIT;
    return status as unknown as WarehouseTransferStatus;
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
        salesOrder: { select: { id: true, orderNo: true, customer: { select: { code: true, name: true } } } },
        lines: {
          orderBy: { lineNo: 'asc' },
          include: { product: true, owner: true, lot: true },
        },
        dispatches: { include: { lines: true }, orderBy: { dispatchedAt: 'asc' } },
        arrivals: { include: { lines: true }, orderBy: { arrivedAt: 'asc' } },
      },
    });
  }

  private toTransferResponse<
    T extends NonNullable<Awaited<ReturnType<WarehouseOperationsService['movementWithDetails']>>>,
  >(movement: T) {
    const grouped = new Map<
      string,
      {
        id: string;
        productId: string;
        product: T['lines'][number]['product'];
        qty: Prisma.Decimal;
        qtyV15: Prisma.Decimal | null;
        pendingDocQty: Prisma.Decimal;
        postedQty: Prisma.Decimal;
        note: string | null;
        allocations: Array<{
          ownerPartyId: string;
          owner: T['lines'][number]['owner'];
          sourceType: 'TP' | 'NCC';
          qty: Prisma.Decimal;
          qtyV15: Prisma.Decimal | null;
          inventoryLotId: string;
        }>;
      }
    >();
    const internalPartyId = movement.fromWarehouse?.legalEntity.partyId;
    const dispatchedByLine = new Map<string, Prisma.Decimal>();
    for (const dispatch of movement.dispatches) {
      if (dispatch.status !== InventoryDocumentStatus.POSTED) continue;
      for (const line of dispatch.lines) {
        dispatchedByLine.set(
          line.movementLineId,
          (dispatchedByLine.get(line.movementLineId) ?? new Prisma.Decimal(0)).plus(line.actualQty),
        );
      }
    }
    for (const line of movement.lines) {
      const current = grouped.get(line.productId);
      const postedQty = dispatchedByLine.get(line.id) ?? new Prisma.Decimal(0);
      if (current) {
        current.qty = current.qty.plus(line.plannedActualQty);
        current.qtyV15 =
          current.qtyV15 == null && line.plannedV15Qty == null
            ? null
            : new Prisma.Decimal(current.qtyV15 ?? 0).plus(line.plannedV15Qty ?? 0);
        current.postedQty = current.postedQty.plus(postedQty);
        current.pendingDocQty = current.qty.minus(current.postedQty);
        current.allocations.push({
          ownerPartyId: line.ownerPartyId,
          owner: line.owner,
          sourceType: line.ownerPartyId === internalPartyId ? 'TP' : 'NCC',
          qty: line.plannedActualQty,
          qtyV15: line.plannedV15Qty,
          inventoryLotId: line.inventoryLotId,
        });
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
          allocations: [
            {
              ownerPartyId: line.ownerPartyId,
              owner: line.owner,
              sourceType: line.ownerPartyId === internalPartyId ? 'TP' : 'NCC',
              qty: line.plannedActualQty,
              qtyV15: line.plannedV15Qty,
              inventoryLotId: line.inventoryLotId,
            },
          ],
        });
      }
    }
    const ownerPartyId = movement.lines[0]?.ownerPartyId;
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
    };
  }

  async listTransfers(q: PageQueryDto) {
    const keyword = q.keyword?.trim();
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
    };
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
          salesOrder: { select: { id: true, orderNo: true, customer: { select: { code: true, name: true } } } },
          lines: { orderBy: { lineNo: 'asc' }, include: { product: true, owner: true, lot: true } },
          dispatches: { include: { lines: true }, orderBy: { dispatchedAt: 'asc' } },
          arrivals: { include: { lines: true }, orderBy: { arrivedAt: 'asc' } },
        },
      }),
      this.prisma.inventoryMovement.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toTransferResponse(row)),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async transfer(id: string) {
    const movement = await this.movementWithDetails(this.prisma, id);
    if (!movement) throw new NotFoundException('Warehouse transfer not found');
    return this.toTransferResponse(movement);
  }

  private aggregateTransferLines(dto: UpsertWarehouseTransferDto) {
    const lines = new Map<
      string,
      { qty: Prisma.Decimal; qtyV15: Prisma.Decimal | null; note: string | null }
    >();
    for (const input of dto.lines) {
      const qty = new Prisma.Decimal(input.qty);
      const qtyV15 = input.qtyV15 == null ? null : new Prisma.Decimal(input.qtyV15);
      const current = lines.get(input.productId);
      if (current) {
        current.qty = current.qty.plus(qty);
        current.qtyV15 =
          current.qtyV15 == null && qtyV15 == null
            ? null
            : new Prisma.Decimal(current.qtyV15 ?? 0).plus(qtyV15 ?? 0);
        current.note = current.note || input.note?.trim() || null;
      } else {
        lines.set(input.productId, { qty, qtyV15, note: input.note?.trim() || null });
      }
    }
    if (!lines.size) throw new BadRequestException('WAREHOUSE_TRANSFER_REQUIRES_LINES');
    return lines;
  }

  async saveTransfer(dto: UpsertWarehouseTransferDto, id?: string) {
    if (dto.fromSupplierLocationId === dto.toSupplierLocationId) {
      throw new BadRequestException('TRANSFER_WAREHOUSES_MUST_BE_DIFFERENT');
    }
    const transferFee = new Prisma.Decimal(dto.transferFee ?? 0);
    if (dto.chargeCustomer && !transferFee.greaterThan(0)) {
      throw new BadRequestException({
        code: 'CUSTOMER_TRANSFER_FEE_REQUIRED',
        message: 'Đã chọn thu phí khách hàng thì phí chuyển kho phải lớn hơn 0.',
      });
    }
    if (dto.chargeCustomer && !dto.salesOrderId) {
      throw new BadRequestException({
        code: 'CUSTOMER_TRANSFER_ORDER_REQUIRED',
        message: 'Phí thu khách phải gắn với một đơn bán cụ thể.',
      });
    }
    if (dto.salesOrderId && !dto.transferReason?.trim()) {
      throw new BadRequestException({
        code: 'SALES_TRANSFER_REASON_REQUIRED',
        message: 'Phiếu chuyển kho gắn đơn bán bắt buộc nhập lý do đổi kho.',
      });
    }
    const requestedLines = this.aggregateTransferLines(dto);
    const movementId = await this.prisma.$transaction(async (tx) => {
      const [fromWarehouse, toWarehouse] = await Promise.all([
        this.warehouseContext(tx, dto.fromSupplierLocationId),
        this.warehouseContext(tx, dto.toSupplierLocationId),
      ]);
      if (fromWarehouse.legalEntityId !== toWarehouse.legalEntityId) {
        throw new BadRequestException('CROSS_LEGAL_ENTITY_MOVEMENT_REQUIRES_OWNERSHIP_TRANSFER');
      }
      const ownerPartyId = await this.ownerPartyId(
        tx,
        dto.fromSupplierLocationId,
        dto.ownerType,
        dto.ownerCustomerId,
      );
      const linkedOrder = dto.salesOrderId
        ? await tx.salesOrder.findUnique({
            where: { id: dto.salesOrderId },
            include: {
              lines: true,
              deliveries: { where: { status: SalesDeliveryStatus.POSTED }, select: { id: true } },
            },
          })
        : null;
      if (dto.salesOrderId && !linkedOrder) throw new NotFoundException('SALES_ORDER_NOT_FOUND');
      if (linkedOrder) {
        if (!linkedOrder.approvedAt || ['DRAFT', 'PENDING_REVIEW', 'REJECTED', 'CANCELLED'].includes(linkedOrder.status)) {
          throw new BadRequestException('SALES_TRANSFER_ORDER_NOT_APPROVED');
        }
        if (linkedOrder.deliveries.length) {
          throw new BadRequestException({
            code: 'SALES_TRANSFER_AFTER_ISSUE_NOT_ALLOWED',
            message: 'Đơn đã xuất kho; không thể đổi kho nhận bằng phiếu chuyển kho.',
          });
        }
        for (const [productId, requested] of requestedLines) {
          const matching = linkedOrder.lines.filter((line) => line.productId === productId);
          const ordered = matching.reduce(
            (sum, line) => sum.plus(line.orderedActualQty),
            new Prisma.Decimal(0),
          );
          if (!matching.length || requested.qty.greaterThan(ordered)) {
            throw new BadRequestException({ code: 'TRANSFER_QTY_EXCEEDS_SALES_ORDER', productId });
          }
          if (!matching.some((line) => line.issueWarehouseId === dto.fromSupplierLocationId)) {
            throw new BadRequestException({
              code: 'TRANSFER_SOURCE_NOT_CURRENT_SALES_WAREHOUSE',
              productId,
            });
          }
        }
      }
      if (id) {
        const current = await tx.inventoryMovement.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Warehouse transfer not found');
        if (current.status !== InventoryMovementStatus.DRAFT) {
          throw new BadRequestException('ONLY_DRAFT_MOVEMENT_CAN_BE_EDITED');
        }
        await tx.expectedSupply.deleteMany({ where: { movementLine: { movementId: id } } });
        await tx.inventoryMovementLine.deleteMany({ where: { movementId: id } });
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
              salesOrderId: dto.salesOrderId ?? null,
              transferReason: dto.transferReason?.trim() || null,
              transferFee,
              chargeCustomer: dto.chargeCustomer ?? false,
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
              salesOrderId: dto.salesOrderId ?? null,
              transferReason: dto.transferReason?.trim() || null,
              transferFee,
              chargeCustomer: dto.chargeCustomer ?? false,
              transportMode: dto.transportMode,
              plannedAt: new Date(dto.transferDate),
              expectedArrivalAt: dto.expectedArrivalDate ? new Date(dto.expectedArrivalDate) : null,
              actualArrivalAt: dto.actualArrivalDate ? new Date(dto.actualArrivalDate) : null,
              note: dto.note?.trim() || null,
            },
          });

      let lineNo = 1;
      for (const [productId, requested] of requestedLines) {
        if (linkedOrder) {
          const reservedSources = await tx.inventoryReservationLine.findMany({
            where: {
              warehouseId: dto.fromSupplierLocationId,
              productId,
              activeActualQty: { gt: 0 },
              reservation: {
                salesOrderId: linkedOrder.id,
                status: ReservationStatus.ACTIVE,
              },
            },
            include: { lot: true },
            orderBy: [{ lot: { receivedAt: 'asc' } }, { id: 'asc' }],
          });
          const reservedQty = reservedSources.reduce(
            (sum, source) => sum.plus(source.activeActualQty),
            new Prisma.Decimal(0),
          );
          if (!reservedQty.equals(requested.qty)) {
            throw new BadRequestException({
              code: 'TRANSFER_MUST_MOVE_FULL_RESERVED_PRODUCT',
              message:
                'Khi đổi kho cho đơn bán, phải chuyển toàn bộ lượng đang giữ của mặt hàng tại kho cũ.',
              productId,
              requestedQty: requested.qty,
              reservedQty,
            });
          }
          const reservedV15Qty = reservedSources.reduce(
            (sum, source) => sum.plus(source.activeV15Qty ?? 0),
            new Prisma.Decimal(0),
          );
          if (requested.qtyV15 != null && !reservedV15Qty.equals(requested.qtyV15)) {
            throw new BadRequestException({
              code: 'TRANSFER_V15_MUST_MATCH_RESERVATION',
              productId,
              requestedV15Qty: requested.qtyV15,
              reservedV15Qty,
            });
          }
          for (const source of reservedSources) {
            if (!source.inventoryLotId) {
              throw new BadRequestException({
                code: 'RESERVED_STOCK_LOT_REQUIRED_FOR_TRANSFER',
                productId,
                reservationLineId: source.id,
              });
            }
            await tx.inventoryMovementLine.create({
              data: {
                movementId: movement.id,
                lineNo,
                productId,
                ownerPartyId: source.ownerPartyId,
                inventoryLotId: source.inventoryLotId,
                salesReservationLineId: source.id,
                plannedActualQty: source.activeActualQty,
                plannedV15Qty: source.activeV15Qty,
                note: requested.note,
              },
            });
            lineNo += 1;
          }
          continue;
        }

        const availability = await tx.inventoryAvailabilityBalance.findUnique({
          where: {
            warehouseId_productId_ownerPartyId: {
              warehouseId: dto.fromSupplierLocationId,
              productId,
              ownerPartyId,
            },
          },
        });
        const sellable = availability
          ? new Prisma.Decimal(availability.onHandActualQty)
              .minus(availability.reservedActualQty)
              .minus(availability.pendingActualQty)
              .minus(availability.blockedActualQty)
          : new Prisma.Decimal(0);
        if (sellable.lessThan(requested.qty)) {
          throw new BadRequestException({ code: 'INSUFFICIENT_SELLABLE_STOCK', productId });
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
        });
        let remaining = requested.qty;
        let remainingV15 = requested.qtyV15;
        for (const stock of stocks) {
          if (!remaining.isPositive()) break;
          const take = Prisma.Decimal.min(remaining, stock.actualQty);
          const isLast = take.equals(remaining);
          const takeV15 =
            remainingV15 == null
              ? null
              : isLast
                ? remainingV15
                : requested.qtyV15!.mul(take).div(requested.qty);
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
          });
          lineNo += 1;
          remaining = remaining.minus(take);
          if (remainingV15 != null) remainingV15 = remainingV15.minus(takeV15 ?? 0);
        }
        if (remaining.isPositive()) {
          throw new BadRequestException({ code: 'STOCK_LOT_ALLOCATION_FAILED', productId });
        }
      }

      const movementLines = await tx.inventoryMovementLine.findMany({
        where: { movementId: movement.id },
      });
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
      });
      return movement.id;
    });
    return this.transfer(movementId);
  }

  private async confirmMovement(id: string) {
    return this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.findUnique({
        where: { id },
        include: { lines: true },
      });
      if (!movement) throw new NotFoundException('Warehouse transfer not found');
      if (movement.status === InventoryMovementStatus.READY) return movement;
      if (movement.status !== InventoryMovementStatus.DRAFT) {
        throw new BadRequestException('ONLY_DRAFT_MOVEMENT_CAN_BE_CONFIRMED');
      }
      if (!movement.lines.length)
        throw new BadRequestException('WAREHOUSE_TRANSFER_REQUIRES_LINES');
      return tx.inventoryMovement.update({
        where: { id },
        data: { status: InventoryMovementStatus.READY, version: { increment: 1 } },
      });
    });
  }

  private async dispatchMovement(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.findUnique({
        where: { id },
        include: {
          lines: { include: { salesReservationLine: true } },
          dispatches: { where: { status: InventoryDocumentStatus.POSTED } },
        },
      });
      if (!movement) throw new NotFoundException('Warehouse transfer not found');
      if (movement.status === InventoryMovementStatus.IN_TRANSIT && movement.dispatches.length)
        return;
      if (movement.status !== InventoryMovementStatus.READY) {
        throw new BadRequestException('ONLY_READY_MOVEMENT_CAN_BE_DISPATCHED');
      }
      if (!movement.fromWarehouseId)
        throw new BadRequestException('MOVEMENT_SOURCE_WAREHOUSE_REQUIRED');

      const dispatchedAt = new Date();
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
      });
      for (const line of movement.lines) {
        if (!line.salesReservationLineId) continue;
        await this.inventory.releaseReservationLine(tx, {
          reservationLineId: line.salesReservationLineId,
          actualQty: line.plannedActualQty,
          v15Qty: line.plannedV15Qty,
          idempotencyKey: `movement:${movement.id}:transfer-release:${line.id}`,
          occurredAt: dispatchedAt,
          reason: movement.transferReason ?? 'Chuyển lượng giữ của đơn bán sang kho mới',
        });
      }
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
      });
      await tx.inventoryDispatch.update({
        where: { id: dispatch.id },
        data: { status: InventoryDocumentStatus.POSTED, version: { increment: 1 } },
      });
      await tx.inventoryMovement.update({
        where: { id: movement.id },
        data: { status: InventoryMovementStatus.IN_TRANSIT, version: { increment: 1 } },
      });
    });
    return this.transfer(id);
  }

  private async arriveMovement(id: string, actualArrivalDate?: string) {
    await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.findUnique({
        where: { id },
        include: {
          lines: {
            include: {
              salesReservationLine: { include: { reservation: true } },
            },
          },
          arrivals: { where: { status: InventoryDocumentStatus.POSTED } },
          dispatches: {
            where: { status: InventoryDocumentStatus.POSTED },
            include: { lines: { include: { movementLine: true } } },
          },
        },
      });
      if (!movement) throw new NotFoundException('Warehouse transfer not found');
      if (movement.status === InventoryMovementStatus.COMPLETED && movement.arrivals.length) return;
      if (movement.status !== InventoryMovementStatus.IN_TRANSIT) {
        throw new BadRequestException('ONLY_IN_TRANSIT_MOVEMENT_CAN_BE_RECEIVED');
      }
      if (!movement.toWarehouseId)
        throw new BadRequestException('MOVEMENT_DESTINATION_WAREHOUSE_REQUIRED');
      const dispatch = movement.dispatches[0];
      if (!dispatch) throw new BadRequestException('POSTED_DISPATCH_NOT_FOUND');

      const arrivedAt = actualArrivalDate ? new Date(actualArrivalDate) : new Date();
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
      });
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
      });
      const movedSalesOrderLineIds = new Set<string>();
      for (const line of movement.lines) {
        const source = line.salesReservationLine;
        if (!source) continue;
        const maxLine = await tx.inventoryReservationLine.aggregate({
          where: { reservationId: source.reservationId },
          _max: { lineNo: true },
        });
        const destinationLine = await tx.inventoryReservationLine.create({
          data: {
            reservationId: source.reservationId,
            lineNo: (maxLine._max.lineNo ?? 0) + 1,
            warehouseId: movement.toWarehouseId,
            productId: line.productId,
            ownerPartyId: line.ownerPartyId,
            inventoryLotId: line.inventoryLotId,
            salesOrderLineId: source.salesOrderLineId,
            withdrawalRequestLineId: source.withdrawalRequestLineId,
            requestedActualQty: line.plannedActualQty,
            requestedV15Qty: line.plannedV15Qty,
          },
        });
        await this.inventory.activateReservationLine(tx, {
          reservationLineId: destinationLine.id,
          actualQty: line.plannedActualQty,
          v15Qty: line.plannedV15Qty,
          idempotencyKey: `movement:${movement.id}:transfer-reserve:${line.id}`,
          occurredAt: arrivedAt,
          reason: movement.transferReason ?? 'Giữ lại hàng cho đơn bán tại kho mới',
        });
        if (source.salesOrderLineId) movedSalesOrderLineIds.add(source.salesOrderLineId);
      }
      if (movement.salesOrderId && movedSalesOrderLineIds.size) {
        await tx.salesOrderLine.updateMany({
          where: {
            salesOrderId: movement.salesOrderId,
            id: { in: [...movedSalesOrderLineIds] },
          },
          data: {
            issueWarehouseId: movement.toWarehouseId,
            receivingWarehouseAreaId: null,
          },
        });
        await tx.salesOrder.update({
          where: { id: movement.salesOrderId },
          data: { version: { increment: 1 } },
        });
      }
      await tx.inventoryArrival.update({
        where: { id: arrival.id },
        data: { status: InventoryDocumentStatus.POSTED, version: { increment: 1 } },
      });
      await tx.expectedSupply.updateMany({
        where: {
          movementLine: { movementId: movement.id },
          status: { not: ExpectedSupplyStatus.CANCELLED },
        },
        data: {
          status: ExpectedSupplyStatus.FULFILLED,
          fulfilledActualQty: 0,
          version: { increment: 1 },
        },
      });
      for (const line of movement.lines) {
        await tx.expectedSupply.updateMany({
          where: { movementLineId: line.id, status: ExpectedSupplyStatus.FULFILLED },
          data: {
            fulfilledActualQty: line.plannedActualQty,
            fulfilledV15Qty: line.plannedV15Qty,
          },
        });
      }
      await tx.inventoryMovement.update({
        where: { id: movement.id },
        data: {
          status: InventoryMovementStatus.COMPLETED,
          actualArrivalAt: arrivedAt,
          version: { increment: 1 },
        },
      });
    });
    return this.transfer(id);
  }

  private async cancelMovement(id: string) {
    await this.prisma.$transaction(async (tx) => {
      const movement = await tx.inventoryMovement.findUnique({ where: { id } });
      if (!movement) throw new NotFoundException('Warehouse transfer not found');
      if (movement.status === InventoryMovementStatus.CANCELLED) return;
      if (
        movement.status !== InventoryMovementStatus.DRAFT &&
        movement.status !== InventoryMovementStatus.READY
      ) {
        throw new BadRequestException('POSTED_MOVEMENT_MUST_BE_REVERSED_INSTEAD_OF_CANCELLED');
      }
      await tx.expectedSupply.updateMany({
        where: {
          movementLine: { movementId: id },
          status: { not: ExpectedSupplyStatus.CANCELLED },
        },
        data: { status: ExpectedSupplyStatus.CANCELLED, version: { increment: 1 } },
      });
      await tx.inventoryMovement.update({
        where: { id },
        data: { status: InventoryMovementStatus.CANCELLED, version: { increment: 1 } },
      });
    });
    return this.transfer(id);
  }

  async changeTransferStatus(
    id: string,
    status: WarehouseTransferStatus,
    actualArrivalDate?: string,
  ) {
    if (status === WarehouseTransferStatus.CONFIRMED) {
      await this.confirmMovement(id);
      return this.transfer(id);
    }
    if (status === WarehouseTransferStatus.IN_TRANSIT) return this.dispatchMovement(id);
    if (status === WarehouseTransferStatus.COMPLETED)
      return this.arriveMovement(id, actualArrivalDate);
    if (status === WarehouseTransferStatus.CANCELLED) return this.cancelMovement(id);
    if (status === WarehouseTransferStatus.DRAFT) return this.transfer(id);
    throw new BadRequestException('WAREHOUSE_TRANSFER_STATUS_NOT_SUPPORTED');
  }
}
