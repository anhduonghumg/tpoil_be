import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateTermGoodsReceiptDto {
    @IsUUID()
    purchaseOrderLineId!: string

    @IsUUID()
    supplierLocationId!: string

    @IsUUID()
    productId!: string

    @IsDateString()
    receiptDate!: string

    @IsNumber()
    @Min(0)
    qty!: number

    @IsOptional()
    @IsNumber()
    tempC?: number

    @IsOptional()
    @IsNumber()
    density?: number

    @IsOptional()
    @IsNumber()
    standardQtyV15?: number

    @IsOptional()
    @IsUUID()
    vehicleId?: string

    @IsOptional()
    @IsUUID()
    driverId?: string

    @IsOptional()
    @IsNumber()
    shippingFee?: number

    @IsOptional()
    @IsString()
    note?: string
}
