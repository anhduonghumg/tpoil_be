import { IsDateString, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateGoodsReceiptAutoConfirmDto {
    @IsUUID()
    purchaseOrderId: string

    @IsUUID()
    purchaseOrderLineId: string

    @IsString()
    receiptNo: string

    @IsDateString()
    receiptDate: string

    @IsNumber()
    @Min(0.0000001)
    qty: number

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsOptional()
    @IsUUID()
    vehicleId?: string

    @IsOptional()
    @IsUUID()
    driverId?: string

    @IsOptional()
    @IsNumber()
    @Min(0)
    shippingFee?: number

    @IsOptional()
    @IsNumber()
    tempC?: number

    @IsOptional()
    @IsNumber()
    density?: number

    @IsOptional()
    @IsNumber()
    standardQtyV15?: number
}

export class ListGoodsReceiptsQueryDto {
    @IsOptional()
    @IsString()
    purchaseOrderId?: string

    @IsOptional()
    @IsString()
    supplierCustomerId?: string

    @IsOptional()
    @IsUUID()
    warehouseId?: string

    @IsOptional()
    @IsUUID()
    productId?: string

    @IsOptional()
    @IsString()
    status?: string

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    limit?: number
}

export class GoodsReceiptStockCardQueryDto {
    @IsUUID()
    warehouseId: string

    @IsUUID()
    productId: string

    @IsOptional()
    @IsUUID()
    ownerPartyId?: string

    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string
}
