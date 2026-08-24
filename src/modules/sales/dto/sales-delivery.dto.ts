import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'
import { SalesDeliveryStatus } from '@prisma/client'

export class ListSalesDeliveriesQueryDto {
    @IsOptional()
    @IsEnum(SalesDeliveryStatus)
    status?: SalesDeliveryStatus

    @IsOptional()
    @IsUUID()
    warehouseId?: string

    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    /** Ngày kế hoạch xuất của lệnh kho. */
    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number
}

export class ReturnSalesDeliveryDto {
    @IsString()
    @MaxLength(1000)
    reason!: string
}

export class ConfirmSalesDeliveryLotDto {
    @IsUUID()
    inventoryLotId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    actualQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    v15Qty?: number
}

export class ConfirmSalesDeliveryLineDto {
    @IsUUID()
    salesDeliveryLineId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    actualQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    v15Qty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    temperatureC?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    vcf?: number

    /** Lots actually issued — sum must equal actualQty (spec v1.2 nguyên tắc 10). */
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ConfirmSalesDeliveryLotDto)
    allocations!: ConfirmSalesDeliveryLotDto[]
}

export class ConfirmSalesDeliveryDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    issueDocNo?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    sourceFileName?: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    sourceFileUrl?: string

    @IsOptional()
    @IsDateString()
    issuedAt?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ConfirmSalesDeliveryLineDto)
    lines!: ConfirmSalesDeliveryLineDto[]
}

export class VoidSalesDeliveryDto {
    @IsString()
    @MaxLength(1000)
    reason!: string

    /** Create a fresh job (with a new hold) so the warehouse can issue again. */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    createRevision?: boolean
}
