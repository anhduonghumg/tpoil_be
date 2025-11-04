import { IsDateString, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator'
import { ContractStatus, ContractType, RiskLevel } from '@prisma/client'

export class CreateContractDto {
    @IsOptional()
    @IsString()
    code?: string

    @IsNotEmpty()
    @IsString()
    customerId!: string

    @IsEnum(ContractType)
    type!: ContractType

    @IsNotEmpty()
    @IsString()
    name: string

    @IsDateString()
    startDate!: string

    @IsDateString()
    endDate!: string

    @IsOptional()
    @IsEnum(ContractStatus)
    status?: ContractStatus

    @IsOptional()
    @IsNumber()
    @Min(0)
    paymentTermDays?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    creditLimitOverride?: number

    @IsOptional()
    sla?: any

    @IsOptional()
    deliveryScope?: any

    @IsOptional()
    @IsEnum(RiskLevel)
    riskLevel?: RiskLevel

    @IsOptional()
    @IsString()
    approvalRequestId?: string
}
