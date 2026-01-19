// src/modules/purchases/goods-receipts/dto/create-goods-receipt.dto.ts
import { IsDateString, IsOptional, IsString, IsUUID, IsNumber } from 'class-validator'

export class CreateGoodsReceiptDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsUUID()
    supplierLocationId!: string

    @IsUUID()
    productId!: string

    @IsString()
    receiptNo!: string

    @IsDateString()
    receiptDate!: string

    @IsNumber()
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
    @IsUUID()
    purchaseOrderId?: string

    @IsOptional()
    @IsUUID()
    purchaseOrderLineId?: string
}
