import { Transform, Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'
import { PaymentTermType, SalesApprovalStatus, SalesApprovalType, SalesOrderKind } from '@prisma/client'

export class SalesOrderLineDto {
    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    receivingWarehouseId?: string

    /** Kho xuất — bắt buộc trước khi gửi kiểm duyệt với đơn SINGLE/LOT. */
    @IsOptional()
    @IsUUID()
    issueWarehouseId?: string

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
    @Min(0)
    discountAmount?: number

    @IsOptional()
    @IsString()
    vehiclePlate?: string

    @IsOptional()
    @IsString()
    driverName?: string

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

/**
 * Single create endpoint dispatching by `kind` (spec v1.2 §14):
 * - DAY_TRADE (default): legacy buy-to-order flow, unchanged behaviour.
 * - SINGLE/LOT: internal sales flow.
 *
 * Pháp nhân không phải dữ liệu Sale nhập: kho xuất đã thuộc đúng một pháp nhân
 * nên hệ thống suy ra từ đó.
 */
export class CreateSalesOrderDto {
    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsEnum(SalesOrderKind)
    kind?: SalesOrderKind

    @IsOptional()
    @IsUUID()
    contractId?: string

    @IsOptional()
    @IsEnum(PaymentTermType)
    paymentTermType?: PaymentTermType

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    paymentTermDays?: number

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

/** Partial update for DRAFT/REJECTED internal orders; lines (if sent) replace all lines. */
export class UpdateSalesOrderDto {
    @IsOptional()
    @IsUUID()
    contractId?: string | null

    @IsOptional()
    @IsEnum(PaymentTermType)
    paymentTermType?: PaymentTermType

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    paymentTermDays?: number | null

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

export class CancelSalesOrderDto {
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    reason?: string
}

export class DecideSalesApprovalDto {
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string
}

export class ListSalesApprovalsQueryDto {
    @IsOptional()
    @IsEnum(SalesApprovalStatus)
    status?: SalesApprovalStatus

    @IsOptional()
    @IsEnum(SalesApprovalType)
    type?: SalesApprovalType

    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    @IsOptional()
    @IsUUID()
    withdrawalRequestId?: string

    /** Chỉ trả về các loại yêu cầu mà người dùng hiện tại có quyền duyệt. */
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    mine?: boolean

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

export class ListSalesOrdersQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(SalesOrderKind)
    kind?: SalesOrderKind

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
