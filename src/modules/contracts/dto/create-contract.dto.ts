import { IsString, IsUUID, IsOptional, IsEnum, IsInt, IsDateString, IsJSON } from 'class-validator'
import { ContractStatus, RiskLevel } from '@prisma/client'

export class CreateContractDto {
    @IsString()
    name: string

    @IsString()
    code: string

    @IsOptional()
    @IsUUID()
    customerId?: string

    @IsUUID()
    contractTypeId: string

    @IsDateString()
    startDate: string

    @IsDateString()
    endDate: string

    @IsEnum(ContractStatus)
    status: ContractStatus

    @IsOptional()
    @IsInt()
    paymentTermDays?: number

    @IsOptional()
    creditLimitOverride?: number

    @IsOptional()
    sla?: any

    @IsOptional()
    deliveryScope?: any

    @IsEnum(RiskLevel)
    riskLevel: RiskLevel

    @IsOptional()
    @IsUUID()
    renewalOfId?: string

    @IsOptional()
    @IsString()
    approvalRequestId?: string
}
