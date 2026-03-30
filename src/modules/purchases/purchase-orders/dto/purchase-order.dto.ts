// src/modules/purchases/purchase-orders/dto/purchase-order.dto.ts
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { PaymentMode, PurchaseOrderType } from '@prisma/client'
import { Type } from 'class-transformer'

export enum PaymentTermType {
    SAME_DAY = 'SAME_DAY',
    NET_DAYS = 'NET_DAYS',
}

export enum PurchaseOrderStatus {
    DRAFT = 'DRAFT',
    APPROVED = 'APPROVED',
    IN_PROGRESS = 'IN_PROGRESS',
    COMPLETED = 'COMPLETED',
    CANCELLED = 'CANCELLED',
}
export class CreatePurchaseOrderLineDto {
    @IsString()
    productId!: string

    @Type(() => Number)
    @IsNumber()
    orderedQty!: number

    @IsOptional()
    @IsString()
    supplierLocationId?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    discountAmount?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    unitPrice?: number

    @IsOptional()
    @IsNumber()
    taxRate?: number
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
    @IsString()
    supplierCustomerId?: string

    @IsOptional()
    @IsEnum(PurchaseOrderType)
    orderType?: PurchaseOrderType

    @IsOptional()
    @IsEnum(PaymentMode)
    paymentMode?: PaymentMode

    @IsOptional()
    @IsEnum(PurchaseOrderStatus)
    status?: PurchaseOrderStatus

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

export class PurchaseOrderPaymentPlanDto {
    @IsDateString()
    dueDate!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    sortOrder?: number
}

export class CreatePurchaseOrderDto {
    @IsString()
    orderNo!: string

    @IsUUID()
    supplierCustomerId!: string

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsEnum(PurchaseOrderType)
    orderType!: PurchaseOrderType

    @IsEnum(PaymentMode)
    paymentMode!: PaymentMode

    @IsEnum(PaymentTermType)
    paymentTermType!: PaymentTermType

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    paymentTermDays?: number

    @IsOptional()
    @Type(() => Boolean)
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

    @IsOptional()
    @ValidateNested({ each: true })
    @Type(() => PurchaseOrderPaymentPlanDto)
    paymentPlans?: PurchaseOrderPaymentPlanDto[]
}

export type PurchaseOrderPaymentPlanInput = {
    dueDate: string
    amount: number
    note?: string
    sortOrder?: number
}
