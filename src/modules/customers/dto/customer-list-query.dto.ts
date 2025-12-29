import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { CustomerStatus, CustomerType, PartyType } from '@prisma/client'

export enum CustomerListRole {
    CUSTOMER = 'CUSTOMER',
    SUPPLIER = 'SUPPLIER',
    INTERNAL = 'INTERNAL',
}

export class CustomerListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(PartyType)
    partyType?: PartyType

    @IsOptional()
    @IsEnum(CustomerListRole)
    role?: CustomerListRole

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
    documentOwnerEmpId?: string

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
