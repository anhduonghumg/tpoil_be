import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { PartyType } from '@prisma/client'

export enum CustomerSelectRole {
    CUSTOMER = 'CUSTOMER',
    SUPPLIER = 'SUPPLIER',
    INTERNAL = 'INTERNAL',
    SHIP_OWNER = 'SHIP_OWNER',
    SEA_CARRIER = 'SEA_CARRIER',
    INSURER = 'INSURER',
    SURVEYOR = 'SURVEYOR',
    SHIPPING_AGENT = 'SHIPPING_AGENT',
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
