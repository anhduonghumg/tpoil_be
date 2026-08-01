import { ConflictException } from '@nestjs/common'
import { InventoryPostingKind, Prisma, ReservationStatus } from '@prisma/client'
import { InventoryCoreService } from './inventory-core.service'

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value)

describe('InventoryCoreService', () => {
    let service: InventoryCoreService

    beforeEach(() => {
        service = new InventoryCoreService()
    })

    it('returns the original posting for a repeated idempotency key', async () => {
        const original = { id: 'posting-1', entries: [] }
        const tx = {
            inventoryPosting: {
                findUnique: jest.fn().mockResolvedValue(original),
                create: jest.fn(),
            },
        } as unknown as Prisma.TransactionClient

        const result = await service.post(tx, {
            postingNo: 'POST-001',
            kind: InventoryPostingKind.RECEIPT,
            idempotencyKey: 'receipt:1',
            effectiveAt: new Date('2026-07-20T00:00:00Z'),
            source: { goodsReceiptId: 'receipt-1' },
            lines: [
                {
                    warehouseId: 'warehouse-1',
                    productId: 'product-1',
                    ownerPartyId: 'owner-1',
                    inventoryLotId: 'lot-1',
                    actualQtyDelta: 10,
                },
            ],
        })

        expect(result).toBe(original)
        expect(tx.inventoryPosting.create).not.toHaveBeenCalled()
    })

    it('rejects a posting that would make lot stock negative', async () => {
        const tx = {
            $executeRaw: jest.fn(),
            inventoryPosting: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'posting-1', entries: [] }),
            },
            inventoryLot: {
                findMany: jest.fn().mockResolvedValue([{ id: 'lot-1', productId: 'product-1' }]),
            },
            stockBalance: {
                upsert: jest.fn().mockResolvedValue({
                    id: 'balance-1',
                    actualQty: decimal(2),
                    v15Qty: null,
                }),
                update: jest.fn(),
            },
            inventoryAvailabilityBalance: {
                upsert: jest.fn(),
                update: jest.fn(),
            },
        } as unknown as Prisma.TransactionClient

        await expect(
            service.post(tx, {
                postingNo: 'POST-002',
                kind: InventoryPostingKind.MOVEMENT_DISPATCH,
                idempotencyKey: 'dispatch:1',
                effectiveAt: new Date('2026-07-20T00:00:00Z'),
                source: { movementDispatchId: 'dispatch-1' },
                lines: [
                    {
                        warehouseId: 'warehouse-1',
                        productId: 'product-1',
                        ownerPartyId: 'owner-1',
                        inventoryLotId: 'lot-1',
                        actualQtyDelta: -3,
                    },
                ],
            }),
        ).rejects.toMatchObject({ response: { code: 'INSUFFICIENT_STOCK' } })
        expect(tx.stockBalance.update).not.toHaveBeenCalled()
    })

    it('updates stock and availability in the same posting transaction', async () => {
        const tx = {
            $executeRaw: jest.fn(),
            inventoryPosting: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: 'posting-1', entries: [] }),
            },
            inventoryLot: {
                findMany: jest.fn().mockResolvedValue([{ id: 'lot-1', productId: 'product-1' }]),
            },
            stockBalance: {
                upsert: jest.fn().mockResolvedValue({
                    id: 'balance-1',
                    actualQty: decimal(5),
                    v15Qty: decimal(4),
                }),
                update: jest.fn(),
            },
            inventoryAvailabilityBalance: {
                upsert: jest.fn().mockResolvedValue({
                    id: 'availability-1',
                    onHandActualQty: decimal(5),
                    reservedActualQty: decimal(1),
                    pendingActualQty: decimal(1),
                    blockedActualQty: decimal(0),
                }),
                update: jest.fn(),
            },
        } as unknown as Prisma.TransactionClient

        await service.post(tx, {
            postingNo: 'POST-003',
            kind: InventoryPostingKind.RECEIPT,
            idempotencyKey: 'receipt:3',
            effectiveAt: new Date('2026-07-20T00:00:00Z'),
            source: { goodsReceiptId: 'receipt-3' },
            lines: [
                {
                    warehouseId: 'warehouse-1',
                    productId: 'product-1',
                    ownerPartyId: 'owner-1',
                    inventoryLotId: 'lot-1',
                    actualQtyDelta: 7,
                    v15QtyDelta: 6,
                },
            ],
        })

        expect(tx.stockBalance.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ actualQty: decimal(12), v15Qty: decimal(10) }),
            }),
        )
        expect(tx.inventoryAvailabilityBalance.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ onHandActualQty: decimal(12) }),
            }),
        )
    })

    it('rejects reservation when all on-hand stock is already restricted', async () => {
        const tx = {
            $executeRaw: jest.fn(),
            inventoryReservationEvent: {
                findUnique: jest.fn().mockResolvedValue(null),
                create: jest.fn(),
            },
            inventoryReservationLine: {
                findUniqueOrThrow: jest.fn().mockResolvedValue({
                    id: 'line-1',
                    reservationId: 'reservation-1',
                    warehouseId: 'warehouse-1',
                    productId: 'product-1',
                    ownerPartyId: 'owner-1',
                    requestedActualQty: decimal(10),
                    activeActualQty: decimal(0),
                    reservation: { status: ReservationStatus.DRAFT },
                }),
            },
            inventoryAvailabilityBalance: {
                findUnique: jest.fn().mockResolvedValue({
                    id: 'availability-1',
                    onHandActualQty: decimal(10),
                    reservedActualQty: decimal(5),
                    pendingActualQty: decimal(3),
                    blockedActualQty: decimal(2),
                }),
                update: jest.fn(),
            },
        } as unknown as Prisma.TransactionClient

        await expect(
            service.activateReservationLine(tx, {
                reservationLineId: 'line-1',
                actualQty: 1,
                idempotencyKey: 'reserve:1',
                occurredAt: new Date('2026-07-20T00:00:00Z'),
            }),
        ).rejects.toBeInstanceOf(ConflictException)
        expect(tx.inventoryReservationEvent.create).not.toHaveBeenCalled()
    })
})
