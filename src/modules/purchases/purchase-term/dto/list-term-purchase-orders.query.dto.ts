import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { PaymentMode, PurchaseOrderStatus, PurchaseOrderType } from '@prisma/client'

export class ListTermPurchaseOrdersQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(PurchaseOrderStatus)
    status?: PurchaseOrderStatus

    @IsOptional()
    @IsEnum(PurchaseOrderType)
    orderType?: PurchaseOrderType

    @IsOptional()
    @IsEnum(PaymentMode)
    paymentMode?: PaymentMode

    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string

    @IsOptional()
    @IsString()
    page?: string

    @IsOptional()
    @IsString()
    pageSize?: string
}
