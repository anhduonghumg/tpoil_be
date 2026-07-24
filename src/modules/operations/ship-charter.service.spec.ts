import { BadRequestException } from '@nestjs/common'
import { Prisma, ShipCharterOrderStatus, TermTransportMode, VesselDocumentType } from '@prisma/client'
import { ShipCharterService } from './ship-charter.service'

const requiredTypes = [
    VesselDocumentType.VESSEL_REGISTRATION,
    VesselDocumentType.VESSEL_INSPECTION,
    VesselDocumentType.FIRE_SAFETY_CERTIFICATE,
    VesselDocumentType.TANK_CALIBRATION_BAREM,
    VesselDocumentType.H_AND_M_INSURANCE,
    VesselDocumentType.P_AND_I_INSURANCE,
]

describe('ShipCharterService master data', () => {
    const prisma = {
        party: { findFirst: jest.fn() },
        vessel: { findUnique: jest.fn(), create: jest.fn() },
    }
    const service = new ShipCharterService(prisma as any, {} as any, {} as any)

    beforeEach(() => jest.clearAllMocks())

    it('rejects a vessel owner without an active ship role', async () => {
        prisma.party.findFirst.mockResolvedValue(null)

        await expect(
            service.createVessel({
                name: 'Tàu thử nghiệm',
                ownerCustomerId: '01900000-0000-7000-8000-000000000001',
            }),
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(prisma.vessel.create).not.toHaveBeenCalled()
    })

    it('reports all six required documents as missing', async () => {
        prisma.vessel.findUnique.mockResolvedValue({ id: 'vessel-1', documentFileUrl: null, documents: [] })

        const result = await service.vesselDocumentCheck('vessel-1')

        expect(result.isReady).toBe(false)
        expect(result.readinessStatus).toBe('NOT_READY')
        expect(result.missingCount).toBe(6)
        expect(result.items).toHaveLength(6)
    })

    it('uses the newest issuance and warns when a document expires within 30 days', async () => {
        const now = new Date()
        const tenDaysLater = new Date(now)
        tenDaysLater.setDate(tenDaysLater.getDate() + 10)
        const documents = requiredTypes.map((documentType, index) => ({
            id: `document-${index}`,
            vesselId: 'vessel-1',
            documentType,
            documentNo: null,
            issuedDate: now,
            expiredDate: index === 1 ? tenDaysLater : null,
            fileUrl: `/files/document-${index}.pdf`,
            note: null,
            createdAt: now,
            updatedAt: now,
        }))
        documents.push({
            ...documents[0],
            id: 'old-expired-document',
            issuedDate: new Date('2020-01-01'),
            expiredDate: new Date('2020-12-31'),
        })
        prisma.vessel.findUnique.mockResolvedValue({ id: 'vessel-1', documentFileUrl: '/files/vessel.pdf', documents })

        const result = await service.vesselDocumentCheck('vessel-1')

        expect(result.isReady).toBe(true)
        expect(result.readinessStatus).toBe('WARNING')
        expect(result.expiringSoonCount).toBe(1)
        expect(result.expiredCount).toBe(0)
    })
})

describe('ShipCharterService workflow rules', () => {
    const tx = {
        shipCharterOrder: { findUnique: jest.fn(), update: jest.fn() },
        shipCharterAppendix: { create: jest.fn() },
    }
    const prisma = {
        purchaseOrder: { findUnique: jest.fn() },
        $transaction: jest.fn(async (work: (client: typeof tx) => unknown) => work(tx)),
    }
    const service = new ShipCharterService(prisma as any, {} as any, {} as any)

    beforeEach(() => jest.clearAllMocks())

    it('rejects creation from a TERM order that is not a chartered sea shipment', async () => {
        prisma.purchaseOrder.findUnique.mockResolvedValue({
            id: 'purchase-order-1',
            transportMode: TermTransportMode.ROAD,
            charterVessel: false,
            lines: [],
            termShipments: [],
            shipCharterOrders: [],
        })

        await expect(service.createOrderFromTerm('purchase-order-1', {})).rejects.toBeInstanceOf(BadRequestException)
    })

    it('blocks confirmation when the selected vessel is missing required documents', async () => {
        tx.shipCharterOrder.findUnique.mockResolvedValue({
            id: 'charter-order-1',
            status: ShipCharterOrderStatus.DRAFT,
            ownerCustomerId: 'owner-1',
            vesselId: 'vessel-1',
            contractId: 'contract-1',
            laycanFrom: new Date('2026-08-01'),
            laycanTo: new Date('2026-08-02'),
            cargoName: 'Xăng RON95',
            loadingPort: 'Nghi Sơn',
            dischargePort: 'Hải Phòng',
            plannedQty: new Prisma.Decimal(1000),
            freightRateVndPerLiter: new Prisma.Decimal(100),
            lossRatePercent: new Prisma.Decimal(0.1),
            purchaseOrder: null,
            vessel: { id: 'vessel-1', ownerCustomerId: 'owner-1', documents: [] },
            contract: { id: 'contract-1', ownerCustomerId: 'owner-1' },
        })

        await expect(
            service.changeOrderStatus('charter-order-1', ShipCharterOrderStatus.CONFIRMED),
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(tx.shipCharterOrder.update).not.toHaveBeenCalled()
    })

    it('does not create an appendix while mandatory order data is incomplete', async () => {
        tx.shipCharterOrder.findUnique.mockResolvedValue({
            id: 'charter-order-1',
            status: ShipCharterOrderStatus.CONFIRMED,
            appendixId: null,
            contractId: null,
            ownerCustomerId: 'owner-1',
            vesselId: 'vessel-1',
            plannedQty: new Prisma.Decimal(1000),
        })

        await expect(
            service.createAppendixFromOrder('charter-order-1', {
                appendixNo: 'PL-01',
                appendixDate: '2026-08-01',
            }),
        ).rejects.toBeInstanceOf(BadRequestException)
        expect(tx.shipCharterAppendix.create).not.toHaveBeenCalled()
    })
})
