import { IsOptional, IsUUID, IsEnum, IsInt, IsDateString, IsString } from 'class-validator'
import { ContractStatus, RiskLevel } from '@prisma/client'
import { Type } from 'class-transformer'

export class ContractListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    customerId?: string

    @IsOptional()
    @IsEnum(ContractStatus)
    status?: ContractStatus

    @IsOptional()
    @IsEnum(RiskLevel)
    riskLevel?: RiskLevel

    @IsOptional()
    @IsDateString()
    startFrom?: string

    @IsOptional()
    @IsDateString()
    startTo?: string

    @IsOptional()
    @IsDateString()
    endFrom?: string

    @IsOptional()
    @IsDateString()
    endTo?: string

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    page?: number = 1

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    pageSize?: number = 20
}
