import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { PartyType } from '@prisma/client'

export enum CustomerSelectRole {
    CUSTOMER = 'CUSTOMER',
    SUPPLIER = 'SUPPLIER',
    INTERNAL = 'INTERNAL',
}

export class CustomerSelectQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(PartyType)
    partyType?: PartyType

    @IsOptional()
    @IsEnum(CustomerSelectRole)
    role?: CustomerSelectRole

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pageSize?: number = 50
}
