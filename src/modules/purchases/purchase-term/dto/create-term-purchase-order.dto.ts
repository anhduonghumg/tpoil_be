import { IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateTermBillInfoDto {
    @IsOptional()
    @IsNumber()
    premium?: number
}

export class CreateTermPurchaseOrderLineDto {
    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsNumber()
    @Min(0.001)
    orderedQty!: number

    @IsOptional()
    @IsNumber()
    unitPrice?: number

    @IsOptional()
    @IsNumber()
    taxRate?: number

    @IsOptional()
    @IsNumber()
    discountAmount?: number
}

export class CreateTermPurchaseOrderDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsDateString()
    orderDate!: string

    @IsOptional()
    @IsDateString()
    expectedDate?: string

    @IsOptional()
    @IsString()
    contractNo?: string

    @IsOptional()
    @IsString()
    deliveryLocation?: string

    @IsOptional()
    @IsString()
    paymentNote?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @ValidateNested()
    @Type(() => CreateTermBillInfoDto)
    billInfo?: CreateTermBillInfoDto

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateTermPurchaseOrderLineDto)
    lines!: CreateTermPurchaseOrderLineDto[]
}
