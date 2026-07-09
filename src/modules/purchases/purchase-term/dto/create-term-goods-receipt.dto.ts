import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateTermGoodsReceiptDto {
    @IsUUID()
    purchaseOrderLineId!: string

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsUUID()
    productId!: string

    @IsDateString()
    receiptDate!: string

    @IsNumber()
    @Min(0.001)
    @Type(() => Number)
    qty!: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    billQty?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    tankQty?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    temporaryWithdrawQty?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    @Type(() => Number)
    billToTankLossQty?: number

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    tempC?: number

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    density?: number

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    standardQtyV15?: number

    @IsOptional()
    @IsUUID()
    vehicleId?: string

    @IsOptional()
    @IsUUID()
    driverId?: string

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    shippingFee?: number

    @IsOptional()
    @IsString()
    receiptDocumentTemplate?: string

    @IsOptional()
    @IsString()
    note?: string
}
