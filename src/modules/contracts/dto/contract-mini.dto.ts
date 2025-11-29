import { ContractStatus, RiskLevel } from '@prisma/client'

export class ContractMiniDto {
    id!: string
    code!: string
    name!: string
    customerId?: string | null
    contractTypeCode?: string | null
    contractTypeName?: string | null
    startDate!: Date
    endDate!: Date
    status!: ContractStatus
    paymentTermDays?: number | null
    riskLevel!: RiskLevel
}
