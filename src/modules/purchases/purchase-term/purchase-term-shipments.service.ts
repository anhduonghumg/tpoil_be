import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PurchaseBizType, TermShipmentStatus, TermTransportMode } from '@prisma/client'
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
                transportMode: true,
            },
        })

        if (!order || order.bizType !== PurchaseBizType.TERM) {
            throw new NotFoundException('TERM_PURCHASE_ORDER_NOT_FOUND')
        }

        return order
    }

    async list(purchaseOrderId: string) {
        await this.ensureTermOrder(purchaseOrderId)

        return this.prisma.termShipment.findMany({
            where: { purchaseOrderId },
            orderBy: { createdAt: 'desc' },
        })
    }

    async create(purchaseOrderId: string, dto: CreateTermShipmentDto) {
        const order = await this.ensureTermOrder(purchaseOrderId)
        const transportMode = dto.transportMode ?? order.transportMode ?? TermTransportMode.SEA

        return this.prisma.termShipment.create({
            data: {
                purchaseOrderId,
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
                status: dto.status ?? TermShipmentStatus.DRAFT,
            },
        })
    }

    async update(purchaseOrderId: string, shipmentId: string, dto: UpdateTermShipmentDto) {
        await this.ensureTermOrder(purchaseOrderId)
        await this.ensureShipment(purchaseOrderId, shipmentId)

        return this.prisma.termShipment.update({
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
            },
        })
    }

    async remove(purchaseOrderId: string, shipmentId: string) {
        await this.ensureTermOrder(purchaseOrderId)
        const shipment = await this.ensureShipment(purchaseOrderId, shipmentId)

        if (shipment._count.logisticsCosts > 0) {
            return this.prisma.termShipment.update({
                where: { id: shipmentId },
                data: { status: TermShipmentStatus.VOID },
            })
        }

        await this.prisma.termShipment.delete({
            where: { id: shipmentId },
        })

        return { deleted: true }
    }

    private async ensureShipment(purchaseOrderId: string, shipmentId: string) {
        const shipment = await this.prisma.termShipment.findFirst({
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
