import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator'

export class SalesOrderLineDto {
    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    receivingWarehouseId?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    orderedActualQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    orderedV15Qty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    unitPrice?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    taxRate?: number

    @IsOptional()
    @IsString()
    note?: string
}

/**
 * Purchasing raises the customer order on behalf of sales so the retail flow can
 * start from a single record. Sales will later own the same document.
 */
export class CreateSalesOrderFromPurchaseDto {
    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsDateString()
    orderDate?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SalesOrderLineDto)
    lines?: SalesOrderLineDto[]
}

/** Sales raises the customer order first; purchasing then buys against it. */
export class CreateSalesOrderDto {
    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsDateString()
    orderDate?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => SalesOrderLineDto)
    lines!: SalesOrderLineDto[]
}

export class ListSalesOrdersQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsString()
    status?: string

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
