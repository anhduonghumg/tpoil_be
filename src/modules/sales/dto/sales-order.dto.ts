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
import {
    PaymentTermType,
    SalesApprovalStatus,
    SalesApprovalType,
    SalesLotInvoiceMode,
    SalesOrderKind,
    SalesOrderSupplySource,
} from '@prisma/client'

export class SalesOrderLineDto {
    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    receivingWarehouseId?: string

    /** Khu vực nhận khi đơn (đặc biệt đơn lô) chưa xác định kho rút cụ thể. */
    @IsOptional()
    @IsUUID()
    receivingWarehouseAreaId?: string

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

    /** CK gốc theo đơn vị. Nếu không gửi thì dùng discountAmount cũ để tương thích dữ liệu cũ. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    discountBaseAmount?: number

    /** CK điều chỉnh theo đơn vị; được phép âm. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    discountAdjustmentAmount?: number

    @IsOptional()
    @IsEnum(SalesOrderSupplySource)
    supplySource?: SalesOrderSupplySource

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

    /**
     * Dòng thuế trong bảng thuế GTGT. Gửi cái này thay vì taxRate trần thì hóa đơn điện
     * tử mới phân biệt được "không chịu thuế" với "thuế suất 0%".
     */
    @IsOptional()
    @IsUUID()
    vatRateId?: string

    @IsOptional()
    @IsString()
    note?: string
}

/** Một đợt thanh toán của đơn bán theo ngày cụ thể. */
export class SalesOrderPaymentPlanDto {
    @IsOptional()
    @IsDateString()
    dueDate?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    percent?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    amount?: number

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

    /** Bắt buộc cho đơn LOT; mặc định ON_WITHDRAWAL nếu không truyền. */
    @IsOptional()
    @IsEnum(SalesLotInvoiceMode)
    lotInvoiceMode?: SalesLotInvoiceMode

    @IsOptional()
    @IsEnum(PaymentTermType)
    paymentTermType?: PaymentTermType

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SalesOrderPaymentPlanDto)
    paymentPlans?: SalesOrderPaymentPlanDto[]

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
    @IsEnum(SalesLotInvoiceMode)
    lotInvoiceMode?: SalesLotInvoiceMode

    @IsOptional()
    @IsEnum(PaymentTermType)
    paymentTermType?: PaymentTermType

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number | null

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => SalesOrderPaymentPlanDto)
    paymentPlans?: SalesOrderPaymentPlanDto[]

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
 * In hàng loạt: chọn tay từng đơn, hoặc lọc theo khách + khoảng ngày (kế toán thường
 * in cả tháng của một đối tác).
 */
export class PrintSalesOrdersDto {
    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    ids?: string[]

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

    @IsOptional()
    @IsEnum(SalesOrderKind)
    kind?: SalesOrderKind
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

    /** Tìm nhanh theo số đơn / số phiếu / mã / tên khách. */
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsEnum(SalesOrderKind)
    kind?: SalesOrderKind

    /** Lọc theo ngày chứng từ: ngày đơn bán, hoặc ngày phiếu rút lô. */
    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

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

/** Duyệt/từ chối nhiều yêu cầu một lượt từ hàng đợi. */
export class DecideManySalesApprovalsDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID(undefined, { each: true })
    ids!: string[]

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string
}

/** Người duyệt sửa CK điều chỉnh trên một dòng đơn đang chờ duyệt. */
export class AdjustLineDiscountDto {
    /** Được phép âm để giảm bớt chiết khấu gốc. */
    @Type(() => Number)
    @IsNumber()
    discountAdjustmentAmount!: number
}

/** Null/không truyền = quay về để hệ thống tự chọn Mã NCC theo FIFO. */
export class AdjustLineSupplierDto {
    @IsOptional()
    @IsUUID()
    supplierPartyId?: string | null

    /** Mã rút đi cùng NCC đã chọn. Bắt buộc về nghiệp vụ khi đổi thủ công. */
    @IsOptional()
    @IsEnum(SalesOrderSupplySource)
    supplySource?: SalesOrderSupplySource
}
