import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseBizType, PurchaseShipmentStatus, TermTransportMode } from '@prisma/client'
import { randomUUID } from 'crypto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateTermShipmentDto, UpdateTermShipmentDto } from './dto/term-shipment.dto'

@Injectable()
export class PurchaseTermShipmentsService {
    constructor(private readonly prisma: PrismaService) {}

    private toDate(value?: string | Date | null): Date | null | undefined {
        if (value === undefined) return undefined
        if (value === null) return null
        if (value instanceof Date) return value
        return new Date(value)
    }

    private async ensureTermOrder(purchaseOrderId: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const order = await tx.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            select: {
                id: true,
                bizType: true,
                termProfile: { select: { transportMode: true } },
                lines: { select: { id: true, orderedQty: true } },
            },
        })

        if (!order || order.bizType !== PurchaseBizType.TERM) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        return order
    }

    async list(purchaseOrderId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        return this.prisma.purchaseShipment.findMany({
            where: { purchaseOrderId },
            include: { lines: true },
            orderBy: { createdAt: 'desc' },
        })
    }

    async create(purchaseOrderId: string, dto: CreateTermShipmentDto) {
        const order = await this.ensureTermOrder(purchaseOrderId)
        const transportMode = dto.transportMode ?? order.termProfile?.transportMode ?? TermTransportMode.SEA

        return this.prisma.purchaseShipment.create({
            data: {
                purchaseOrderId,
                shipmentNo: `SHP-${randomUUID().slice(0, 8).toUpperCase()}`,
                transportMode,
                vesselName: dto.vesselName?.trim() || null,
                voyageNo: dto.voyageNo?.trim() || null,
                blNo: dto.blNo?.trim() || null,
                loadingPort: dto.loadingPort?.trim() || null,
                dischargePort: dto.dischargePort?.trim() || null,
                etd: this.toDate(dto.etd),
                eta: this.toDate(dto.eta),
                surveyorName: dto.surveyorName?.trim() || null,
                note: dto.note?.trim() || null,
                status: dto.status ?? PurchaseShipmentStatus.DRAFT,
                lines: {
                    create: order.lines.map((line) => ({
                        purchaseOrderLineId: line.id,
                        plannedActualQty: line.orderedQty,
                    })),
                },
            },
            include: { lines: true },
        })
    }

    async update(purchaseOrderId: string, shipmentId: string, dto: UpdateTermShipmentDto) {
        await this.ensureTermOrder(purchaseOrderId)
        await this.ensureShipment(purchaseOrderId, shipmentId)

        return this.prisma.purchaseShipment.update({
            where: { id: shipmentId },
            data: {
                transportMode: dto.transportMode,
                vesselName: dto.vesselName !== undefined ? dto.vesselName?.trim() || null : undefined,
                voyageNo: dto.voyageNo !== undefined ? dto.voyageNo?.trim() || null : undefined,
                blNo: dto.blNo !== undefined ? dto.blNo?.trim() || null : undefined,
                loadingPort: dto.loadingPort !== undefined ? dto.loadingPort?.trim() || null : undefined,
                dischargePort: dto.dischargePort !== undefined ? dto.dischargePort?.trim() || null : undefined,
                etd: this.toDate(dto.etd),
                eta: this.toDate(dto.eta),
                surveyorName: dto.surveyorName !== undefined ? dto.surveyorName?.trim() || null : undefined,
                note: dto.note !== undefined ? dto.note?.trim() || null : undefined,
                status: dto.status,
                version: { increment: 1 },
            },
        })
    }

    async remove(purchaseOrderId: string, shipmentId: string) {
        await this.ensureTermOrder(purchaseOrderId)
        const shipment = await this.ensureShipment(purchaseOrderId, shipmentId)

        if (shipment._count.logisticsCosts > 0) {
            return this.prisma.purchaseShipment.update({
                where: { id: shipmentId },
                data: { status: PurchaseShipmentStatus.VOID, version: { increment: 1 } },
            })
        }

        await this.prisma.$transaction(async (tx) => {
            await tx.purchaseShipmentLine.deleteMany({ where: { shipmentId } })
            await tx.purchaseShipment.delete({ where: { id: shipmentId } })
        })

        return { deleted: true }
    }

    private async ensureShipment(purchaseOrderId: string, shipmentId: string) {
        const shipment = await this.prisma.purchaseShipment.findFirst({
            where: {
                id: shipmentId,
                purchaseOrderId,
            },
            include: {
                _count: {
                    select: {
                        logisticsCosts: true,
                    },
                },
            },
        })

        if (!shipment) {
            throw new BadRequestException('TERM_SHIPMENT_NOT_FOUND')
        }

        return shipment
    }
}
