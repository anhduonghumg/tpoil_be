// src/modules/purchases/purchase-orders/dto/purchase-order.dto.ts
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'
import { PaymentMode, PurchaseOrderType } from '@prisma/client'

export enum PaymentTermType {
    SAME_DAY = 'SAME_DAY',
    NET_DAYS = 'NET_DAYS',
}

export class CreatePurchaseOrderLineDto {
    @IsUUID()
    productId!: string

    @IsNumber()
    orderedQty!: number

    @IsOptional()
    @IsNumber()
    unitPrice?: number

    @IsOptional()
    @IsNumber()
    taxRate?: number
}

export class CreatePurchaseOrderDto {
    @IsString()
    orderNo!: string

    @IsUUID()
    supplierCustomerId!: string

    @IsEnum(PurchaseOrderType)
    orderType!: PurchaseOrderType

    @IsEnum(PaymentMode)
    paymentMode!: PaymentMode

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsEnum(PaymentTermType)
    paymentTermType!: PaymentTermType

    @IsOptional()
    @IsInt()
    @Min(1)
    paymentTermDays?: number

    @IsOptional()
    @IsBoolean()
    allowPartialPayment?: boolean

    @IsDateString()
    orderDate!: string

    @IsOptional()
    @IsDateString()
    expectedDate?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreatePurchaseOrderLineDto)
    lines!: CreatePurchaseOrderLineDto[]
}

export class ApprovePurchaseOrderDto {
    @IsOptional()
    @IsString()
    note?: string
}

export class ListPurchaseOrdersQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsEnum(PurchaseOrderType)
    orderType?: PurchaseOrderType

    @IsOptional()
    @IsEnum(PaymentMode)
    paymentMode?: PaymentMode

    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

    @IsOptional()
    @IsInt()
    page?: number

    @IsOptional()
    @IsInt()
    limit?: number
}
