import { Injectable, NotFoundException } from '@nestjs/common'
import { ContractStatus, Prisma } from '@prisma/client'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class ContractsService {
    constructor(private readonly prisma: PrismaService) {}

    private async generateCodeInternal(customerId: string): Promise<string> {
        const now = new Date()
        const ym = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`

        const count = await this.prisma.contract.count({
            where: {
                customerId,
                createdAt: {
                    gte: new Date(`${now.getFullYear()}-${now.getMonth() + 1}-01`),
                },
            },
        })

        const seq = String(count + 1).padStart(3, '0')
        return `CON-${ym}-${seq}`
    }

    async list(query: ContractListQueryDto) {
        const { page = 1, pageSize = 20, keyword, customerId, type, status, startFrom, startTo } = query

        const where: Prisma.ContractWhereInput = {
            deletedAt: null,
        }

        if (customerId) where.customerId = customerId
        if (type) where.type = type
        if (status) where.status = status

        if (keyword) {
            where.OR = [{ code: { contains: keyword, mode: 'insensitive' } }, { customer: { name: { contains: keyword, mode: 'insensitive' } } }]
        }

        if (startFrom || startTo) {
            where.startDate = {}
            if (startFrom) (where.startDate as any).gte = new Date(startFrom)
            if (startTo) (where.startDate as any).lte = new Date(startTo)
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.contract.findMany({
                where,
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    customer: { select: { id: true, code: true, name: true } },
                },
            }),
            this.prisma.contract.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
        }
    }

    async findOne(id: string) {
        const contract = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
            include: {
                customer: { select: { id: true, code: true, name: true } },
                items: true,
                appendices: true,
                attachments: true,
            },
        })
        if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng ')
        return contract
    }

    async create(dto: CreateContractDto) {
        const { code, customerId, type, name, startDate, endDate, status, paymentTermDays, creditLimitOverride, sla, deliveryScope, riskLevel, approvalRequestId } = dto

        const finalCode = code?.trim() || (await this.generateCodeInternal(customerId))

        return this.prisma.contract.create({
            data: {
                code: finalCode,
                customerId,
                type,
                name,
                startDate: new Date(startDate),
                endDate: new Date(endDate),
                status: status ?? ContractStatus.Draft,
                paymentTermDays,
                creditLimitOverride,
                sla,
                deliveryScope,
                riskLevel,
                approvalRequestId,
            },
        })
    }

    async update(id: string, dto: UpdateContractDto) {
        const existing = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng ')

        const data: Prisma.ContractUpdateInput = {}

        if (dto.code !== undefined) data.code = dto.code.trim()
        if (dto.type !== undefined) data.type = dto.type
        if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate)
        if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate)
        if (dto.status !== undefined) data.status = dto.status
        if (dto.paymentTermDays !== undefined) data.paymentTermDays = dto.paymentTermDays
        if (dto.creditLimitOverride !== undefined) data.creditLimitOverride = dto.creditLimitOverride
        if (dto.sla !== undefined) data.sla = dto.sla
        if (dto.deliveryScope !== undefined) data.deliveryScope = dto.deliveryScope
        if (dto.riskLevel !== undefined) data.riskLevel = dto.riskLevel
        if (dto.approvalRequestId !== undefined) data.approvalRequestId = dto.approvalRequestId

        return this.prisma.contract.update({
            where: { id },
            data,
        })
    }

    async softDelete(id: string) {
        const existing = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng ')

        await this.prisma.contract.update({
            where: { id },
            data: { deletedAt: new Date() },
        })

        return { success: true }
    }

    async generateCode(customerId: string) {
        const code = await this.generateCodeInternal(customerId)
        return { code }
    }
}
