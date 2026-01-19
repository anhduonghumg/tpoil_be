// dto/list-price-bulletins.dto.ts
import { IsOptional, IsString, IsIn, IsInt, Min, IsNumberString, IsEnum } from 'class-validator'
import { Type } from 'class-transformer'
import { PriceBulletinStatus } from '@prisma/client'

export class ListPriceBulletinsDto {
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    page?: number

    @Type(() => Number)
    @IsInt()
    @Min(1)
    @IsOptional()
    pageSize?: number

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsIn(['DRAFT', 'PUBLISHED', 'VOID'])
    status?: 'DRAFT' | 'PUBLISHED' | 'VOID'
}

export class ListPriceItemsDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(PriceBulletinStatus)
    status?: PriceBulletinStatus

    @IsOptional()
    @IsString()
    productId?: string

    @IsOptional()
    @IsString()
    regionId?: string

    @IsOptional()
    @IsString()
    onDate?: string

    @IsOptional()
    @IsNumberString()
    page?: string

    @IsOptional()
    @IsNumberString()
    pageSize?: string
}
