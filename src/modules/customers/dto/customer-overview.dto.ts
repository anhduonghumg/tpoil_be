import { CustomerStatus, CustomerType, RiskLevel, ContractStatus } from '@prisma/client'

export class CustomerOwnerMiniDto {
    id!: string
    fullName!: string
    title?: string | null
    phone?: string | null
    workEmail?: string | null
}

export class CustomerCreditInfoDto {
    creditLimit?: number | null
    tempLimit?: number | null
    tempFrom?: Date | null
    tempTo?: Date | null
}

export class CustomerOverviewContractMiniDto {
    id!: string
    code!: string
    name!: string
    contractTypeCode?: string | null
    contractTypeName?: string | null
    startDate!: Date
    endDate!: Date
    status!: ContractStatus
    paymentTermDays?: number | null
    riskLevel!: RiskLevel
}

export class CustomerDebtSummaryDto {
    opening!: number
    invoices!: number
    payments!: number
    balance!: number
    currency!: string
}

export class InventoryItemSummaryDto {
    sku!: string
    name?: string
    warehouseCode!: string
    warehouseName?: string
    qty!: number
    cost?: number | null
    amount?: number | null
}

export class InventorySummaryDto {
    items!: InventoryItemSummaryDto[]
    totalValue!: number
    currency!: string
}

export class CustomerOverviewResponseDto {
    customer!: {
        id: string
        code: string
        name: string
        type: CustomerType
        status: CustomerStatus
        taxCode?: string | null
        billingAddress?: string | null
        shippingAddress?: string | null
        contactEmail?: string | null
        contactPhone?: string | null
        owners: {
            sales?: CustomerOwnerMiniDto | null
            accounting?: CustomerOwnerMiniDto | null
            legal?: CustomerOwnerMiniDto | null
        }
        credit: CustomerCreditInfoDto
    }

    contracts!: {
        active: CustomerOverviewContractMiniDto[]
        upcoming: CustomerOverviewContractMiniDto[]
        expired: CustomerOverviewContractMiniDto[]
        terminated: CustomerOverviewContractMiniDto[]
        cancelled: CustomerOverviewContractMiniDto[]
    }

    debt!: CustomerDebtSummaryDto
    inventory!: InventorySummaryDto
}
