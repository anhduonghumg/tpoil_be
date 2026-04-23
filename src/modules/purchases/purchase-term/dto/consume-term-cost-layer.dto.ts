import { IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class ConsumeTermCostLayerItemDto {
    @IsUUID()
    productId!: string

    @IsUUID()
    supplierLocationId!: string

    @IsNumber()
    @Min(0)
    qty!: number
}

export class ConsumeTermCostLayerDto {
    @IsDateString()
    consumeDate!: string

    @IsOptional()
    @IsString()
    sourceType?: string

    @IsOptional()
    @IsString()
    sourceId?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ConsumeTermCostLayerItemDto)
    items!: ConsumeTermCostLayerItemDto[]
}
