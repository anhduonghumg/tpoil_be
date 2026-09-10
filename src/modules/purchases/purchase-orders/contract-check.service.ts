import { BadRequestException, Injectable } from '@nestjs/common'
import { ContractStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { TRADING_CONTRACT_TYPE_WHERE } from 'src/modules/contracts/contract-type.constants'

export type ContractWarning = {
    level: 'info' | 'warning'
    code: 'CONTRACT_OK' | 'CONTRACT_NONE' | 'CONTRACT_EXPIRING_SOON'
    message: string
    contractId?: string
    contractCode?: string
    contractName?: string
    startDate?: string
    endDate?: string
} | null

@Injectable()
export class ContractCheckService {
    constructor(private readonly prisma: PrismaService) {}

    async findActivePurchaseContract(args: { supplierCustomerId: string; onDate: Date }) {
        return this.prisma.contract.findFirst({
            where: {
                customerId: args.supplierCustomerId,
                // Lọc theo LOẠI hợp đồng, không theo chiều: chiều được phép mua của đối
                // tác này do loại thương nhân quyết định và assertCanTrade() đã chặn.
                contractType: TRADING_CONTRACT_TYPE_WHERE,
                status: ContractStatus.Active,
                startDate: { lte: args.onDate },
                endDate: { gte: args.onDate },
                deletedAt: null,
            },
            orderBy: { endDate: 'asc' },
            select: { id: true, startDate: true, endDate: true, code: true, name: true },
        })
    }

    async requireActivePurchaseContract(args: { supplierCustomerId: string; onDate: Date }) {
        const contract = await this.findActivePurchaseContract(args)
        if (!contract) {
            throw new BadRequestException({
                code: 'ACTIVE_PURCHASE_CONTRACT_REQUIRED',
                message: 'Nhà cung cấp phải có hợp đồng mua bán xăng dầu còn hiệu lực tại ngày đặt hàng.',
            })
        }
        return contract
    }

    async checkPurchaseContractWarning(args: {
        supplierCustomerId: string
        onDate: Date
        expiringSoonDays?: number
    }): Promise<ContractWarning> {
        const { supplierCustomerId, onDate, expiringSoonDays = 7 } = args
        const contract = await this.findActivePurchaseContract({ supplierCustomerId, onDate })

        if (!contract) {
            return {
                level: 'warning',
                code: 'CONTRACT_NONE',
                message: 'Không tìm thấy hợp đồng mua hàng đang hiệu lực cho nhà cung cấp tại ngày đặt hàng.',
            }
        }

        const daysLeft = Math.floor((contract.endDate.getTime() - onDate.getTime()) / 86_400_000)
        const base = {
            contractId: contract.id,
            contractCode: contract.code,
            contractName: contract.name,
            startDate: contract.startDate.toISOString().slice(0, 10),
            endDate: contract.endDate.toISOString().slice(0, 10),
        }

        if (daysLeft <= expiringSoonDays) {
            return {
                ...base,
                level: 'warning',
                code: 'CONTRACT_EXPIRING_SOON',
                message: `Hợp đồng mua hàng sắp hết hạn (còn ${Math.max(daysLeft, 0)} ngày).`,
            }
        }

        return {
            ...base,
            level: 'info',
            code: 'CONTRACT_OK',
            message: 'Hợp đồng mua hàng đang hiệu lực.',
        }
    }
}
