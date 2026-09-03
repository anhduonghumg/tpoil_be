import { Type } from 'class-transformer'
import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsString,
    IsUUID,
    Max,
    MaxLength,
    Min,
} from 'class-validator'
import { InvoiceEnvironment, SalesInvoiceStatus } from '@prisma/client'

/** Exactly one source: a SINGLE order as a whole, or one LOT draw. */
export class InvoiceSourceDto {
    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    @IsOptional()
    @IsUUID()
    withdrawalRequestId?: string
}

export class ListSalesInvoicesQueryDto {
    @IsOptional()
    @IsEnum(SalesInvoiceStatus)
    status?: SalesInvoiceStatus

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    accountantEmployeeId?: string

    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    /** Hóa đơn của một lần rút lô có salesOrderId = null, phải lọc bằng chính phiếu rút. */
    @IsOptional()
    @IsUUID()
    withdrawalRequestId?: string

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

/** Sources that have reached the invoicing stage but do not yet have a live original invoice. */
export class ListUnissuedSalesInvoicesQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    accountantEmployeeId?: string

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

export class CancelSalesInvoiceDto {
    @IsString()
    @MaxLength(1000)
    reason!: string
}

/** Explicit confirmation after the server reports a live credit-risk snapshot. */
export class IssueSalesInvoiceDto {
    @IsOptional()
    @IsBoolean()
    overrideCredit?: boolean

    @IsOptional()
    @IsString()
    @MaxLength(128)
    creditSnapshotHash?: string
}

/**
 * Cấu hình nhà cung cấp hóa đơn điện tử. Mật khẩu và AppID để trống = giữ nguyên giá trị
 * đang lưu; màn cấu hình không bao giờ nhận được giá trị thật nên không thể gửi lại.
 */
export class UpdateInvoiceProviderConfigDto {
    /** Lưu cho môi trường nào — thử nghiệm hay thật. */
    @IsEnum(InvoiceEnvironment)
    environment!: InvoiceEnvironment

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    baseUrl!: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    taxCode!: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(128)
    username!: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    password?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    appId?: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    templateNo!: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    serial!: string

    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(9)
    signType?: number

    @IsOptional()
    @IsString()
    @MaxLength(50)
    paymentMethod?: string

    /** MISA yêu cầu phát hành tuần tự; đặt quá thấp sẽ bị từ chối vì gọi dồn. */
    @IsOptional()
    @IsInt()
    @Min(0)
    @Max(60_000)
    publishMinGapMs?: number

    /** Dòng thuế áp cho dòng đơn chưa tự chọn. Để trống = xóa mặc định. */
    @IsOptional()
    @IsUUID()
    defaultVatRateId?: string | null

    @IsOptional()
    @IsBoolean()
    mock?: boolean
}

/** Chuyển môi trường đang dùng để phát hành. */
export class ActivateInvoiceEnvironmentDto {
    @IsEnum(InvoiceEnvironment)
    environment!: InvoiceEnvironment
}
