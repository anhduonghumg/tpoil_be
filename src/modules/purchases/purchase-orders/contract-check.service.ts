// src/modules/purchases/purchase-orders/contract-check.service.ts
import { Injectable } from '@nestjs/common'
import { ContractKind, ContractStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

export type ContractWarning = {
    level: 'info' | 'warning'
    code: 'CONTRACT_OK' | 'CONTRACT_NONE' | 'CONTRACT_EXPIRED' | 'CONTRACT_NOT_YET_EFFECTIVE' | 'CONTRACT_EXPIRING_SOON'
    message: string
    contractId?: string
    startDate?: string
    endDate?: string
} | null

@Injectable()
export class ContractCheckService {
    constructor(private readonly prisma: PrismaService) {}

    async checkPurchaseContractWarning(args: { supplierCustomerId: string; onDate: Date; expiringSoonDays?: number }): Promise<ContractWarning> {
        const { supplierCustomerId, onDate, expiringSoonDays = 7 } = args

        const contract = await this.prisma.contract.findFirst({
            where: {
                customerId: supplierCustomerId,
                kind: ContractKind.PURCHASE,
                status: ContractStatus.Active,
                startDate: { lte: onDate },
                endDate: { gte: onDate },
                deletedAt: null,
            },
            orderBy: { endDate: 'asc' },
            select: { id: true, startDate: true, endDate: true, code: true, name: true },
        })

        if (!contract) {
            return {
                level: 'warning',
                code: 'CONTRACT_NONE',
                message: 'Không tìm thấy hợp đồng mua hàng đang hiệu lực cho NCC tại ngày chứng từ.',
            }
        }

        const end = new Date(contract.endDate)
        const msLeft = end.getTime() - onDate.getTime()
        const daysLeft = Math.floor(msLeft / (24 * 3600 * 1000))

        if (daysLeft < 0) {
            return {
                level: 'warning',
                code: 'CONTRACT_EXPIRED',
                message: 'Hợp đồng mua hàng đã hết hạn tại ngày chứng từ.',
                contractId: contract.id,
                startDate: contract.startDate.toISOString().slice(0, 10),
                endDate: contract.endDate.toISOString().slice(0, 10),
            }
        }

        if (daysLeft <= expiringSoonDays) {
            return {
                level: 'warning',
                code: 'CONTRACT_EXPIRING_SOON',
                message: `Hợp đồng mua hàng sắp hết hạn (còn ${daysLeft} ngày).`,
                contractId: contract.id,
                startDate: contract.startDate.toISOString().slice(0, 10),
                endDate: contract.endDate.toISOString().slice(0, 10),
            }
        }

        return {
            level: 'info',
            code: 'CONTRACT_OK',
            message: 'Hợp đồng mua hàng đang hiệu lực.',
            contractId: contract.id,
            startDate: contract.startDate.toISOString().slice(0, 10),
            endDate: contract.endDate.toISOString().slice(0, 10),
        }
    }
}
