import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { CustomerStatus, CustomerType } from '@prisma/client'

export class CustomerListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(CustomerType)
    type?: CustomerType

    @IsOptional()
    @IsEnum(CustomerStatus)
    status?: CustomerStatus

    @IsOptional()
    @IsString()
    salesOwnerEmpId?: string

    @IsOptional()
    @IsString()
    accountingOwnerEmpId?: string

    @IsOptional()
    @IsString()
    legalOwnerEmpId?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pageSize?: number = 20
}
