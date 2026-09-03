import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator'

export class CreateSalesOrderAdjustmentLineDto {
    @IsUUID()
    salesOrderLineId!: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 6 })
    @Min(0.000001)
    adjustedQty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 8 })
    @Min(0)
    adjustedUnitPrice?: number
}

export class CreateSalesOrderAdjustmentDto {
    @IsUUID()
    salesOrderId!: string

    @IsString()
    reason!: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSalesOrderAdjustmentLineDto)
    lines!: CreateSalesOrderAdjustmentLineDto[]
}

export class DecideSalesOrderAdjustmentDto {
    @IsOptional()
    @IsString()
    note?: string
}
