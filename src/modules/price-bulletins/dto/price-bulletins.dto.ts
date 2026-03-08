// src/modules/pricing/price-bulletins/dto/price-bulletins.dto.ts
import { ArrayMinSize, IsArray, IsDateString, IsOptional, IsString } from 'class-validator'

export class QuotePriceQueryDto {
    @IsString()
    productId!: string

    @IsString()
    regionCode!: string

    @IsOptional()
    @IsDateString()
    onDate?: string
}

export class RegionsSelectQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string
}

export class QuoteBatchDto {
    @IsArray()
    @ArrayMinSize(1)
    productIds!: string[]

    @IsString()
    regionCode!: string

    @IsOptional()
    @IsDateString()
    onDate?: string
}
