import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { PaymentMode, PaymentTermType, PurchaseOrderType } from '@prisma/client'

export class CreateTermPurchaseOrderLineDto {
    @IsString()
    productId!: string

    @IsOptional()
    @IsString()
    supplierLocationId?: string

    @IsNumber()
    @Min(0)
    orderedQty!: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    unitPrice?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    taxRate?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    discountAmount?: number
}

export class CreateTermPurchaseOrderDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsEnum(PurchaseOrderType)
    orderType!: PurchaseOrderType

    @IsEnum(PaymentMode)
    paymentMode!: PaymentMode

    @IsOptional()
    @IsEnum(PaymentTermType)
    paymentTermType?: PaymentTermType

    @IsOptional()
    paymentTermDays?: number

    @IsDateString()
    orderDate!: string

    @IsOptional()
    @IsDateString()
    expectedDate?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    contractNo?: string

    @IsOptional()
    @IsString()
    deliveryLocation?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateTermPurchaseOrderLineDto)
    lines!: CreateTermPurchaseOrderLineDto[]
}
