import { ContractStatus, RiskLevel } from '@prisma/client'

export type ContractExpiryDerivedStatus = 'expiring' | 'expired'
export type ContractExpiryFilterStatus = 'expiring' | 'expired' | 'all'

export interface ContractExpiryCounts {
    referenceDate: Date
    expiringCount: number
    expiredCount: number
}

export interface ContractExpiryListItem {
    // Contract
    contractId: string
    contractCode: string
    contractName: string
    contractTypeName?: string | null

    startDate: Date
    endDate: Date
    status: ContractStatus
    riskLevel: RiskLevel
    paymentTermDays?: number | null

    // Customer
    customerId?: string | null
    customerCode?: string | null
    customerName?: string | null
    customerTaxCode?: string | null

    // Owners (tùy schema Customer của bạn)
    salesOwnerName?: string | null
    salesOwnerEmail?: string | null
    accountingOwnerName?: string | null
    accountingOwnerEmail?: string | null

    // Derived
    derivedStatus: ContractExpiryDerivedStatus
    daysToEnd?: number
    daysSinceEnd?: number
}

export interface ContractExpiryListParams {
    referenceDate?: Date
    status?: ContractExpiryFilterStatus
    page?: number
    pageSize?: number
}

export interface ContractExpiryListResult {
    referenceDate: Date
    status: ContractExpiryFilterStatus

    items: ContractExpiryListItem[]
    total: number
    page: number
    pageSize: number
    totalPages: number

    // summary để header dễ dùng
    expiringCount: number
    expiredCount: number
}
