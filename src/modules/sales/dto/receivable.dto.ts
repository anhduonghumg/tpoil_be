import { Transform, Type } from 'class-transformer'
import {
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
} from 'class-validator'
import { ArrayMinSize, IsArray, IsIn, ValidateNested } from 'class-validator'
import { CollectionPlanStatus, CustomerReceiptStatus, ReceivableOpenItemStatus } from '@prisma/client'

export class AllocateReceivableDto {
    @IsUUID()
    bankTransactionId!: string

    @IsUUID()
    openItemId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number

    /** Optional caller-supplied key so a retried request cannot double-apply. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    idempotencyKey?: string
}

export class AllocateReceiptLineDto {
    @IsUUID()
    openItemId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number
}

/** One inbound bank transaction can settle many receivables. */
export class AllocateBankReceiptDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => AllocateReceiptLineDto)
    allocations!: AllocateReceiptLineDto[]

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class ListReceivablesQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsEnum(ReceivableOpenItemStatus)
    status?: ReceivableOpenItemStatus

    // Boolean('false') === true, nên query string phải parse tay.
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    onlyOpen?: boolean

    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    overdueOnly?: boolean

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
    /** Kế toán phụ trách khách hàng (Party.accountingOwnerEmpId). */
    @IsOptional()
    @IsUUID()
    accountingOwnerEmpId?: string
}

export class PartyDebtQueryDto {
    @IsOptional()
    @IsUUID()
    partyId?: string
    /** Kế toán phụ trách khách hàng (Party.accountingOwnerEmpId). */
    @IsOptional()
    @IsUUID()
    accountingOwnerEmpId?: string
}

export class ReceivableAgingQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    /** Report date in YYYY-MM-DD; defaults to today. */
    @IsOptional()
    @IsString()
    asOf?: string
}

export class ReceivableCollectionKpiQueryDto {
    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string
}

/** Daily collection plan at customer level; no sales order is required. */
export class CreateCollectionPlanDto {
    @IsUUID()
    customerPartyId!: string

    @IsDateString()
    plannedDate!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    plannedAmount!: number

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    confirmationNote?: string

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string
}

/** Carry the uncollected part of a plan to a new promised date without losing its history. */
export class CarryForwardCollectionPlanDto {
    @IsDateString()
    plannedDate!: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount?: number

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    confirmationNote?: string

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string
}

export class ListCollectionPlansQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string

    @IsOptional()
    @IsEnum(CollectionPlanStatus)
    status?: CollectionPlanStatus
}

/**
 * Đảo một khoản thu / phân bổ.
 *   - CORRECTION (mặc định): ghi nhận nhầm (sai khách, sai số tiền) → bút đảo lấy đúng ngày
 *     của bút gốc, sổ công nợ và lãi công nợ trở về như chưa từng ghi nhầm.
 *   - BANK_REVERSAL: ngân hàng hoàn trả / hủy giao dịch về sau → bút đảo lấy ngày hôm nay,
 *     vì trong khoảng giữa công ty thật sự đã cầm tiền.
 */
export class ReverseReceiptDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string

    @IsOptional()
    @IsIn(['CORRECTION', 'BANK_REVERSAL'])
    mode?: 'CORRECTION' | 'BANK_REVERSAL'
}

export class BankReceiptFifoItemDto {
    @IsUUID()
    bankTransactionId!: string

    @IsUUID()
    customerPartyId!: string

    /** Khoản thu sale đã báo cho đúng giao dịch này: ghép vào thay vì ghi tiền lần hai. */
    @IsOptional()
    @IsUUID()
    customerReceiptId?: string

    /** Lưu STK người chuyển cho khách để lần sau tự nhận diện. */
    @IsOptional()
    @IsBoolean()
    rememberAccount?: boolean
}

/**
 * Ghi nhận tiền về vào công nợ khách theo lũy kế: không chọn đơn, hệ thống trừ vào khoản
 * phải thu có hạn sớm nhất trước (FIFO), ngày trừ nợ là ngày giao dịch trên sao kê.
 */
export class PostBankReceiptsFifoDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => BankReceiptFifoItemDto)
    items!: BankReceiptFifoItemDto[]
}

/** Customer-reported payment; it affects debt only after a separate confirmation. */
export class CreateCustomerReceiptDto {
    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsUUID()
    collectionPlanId?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number

    @IsOptional()
    @IsString()
    @MaxLength(3)
    currency?: string

    @IsDateString()
    receivedAt!: string

    @IsOptional()
    @IsString()
    @MaxLength(300)
    transferReference?: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    evidenceReference?: string

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    note?: string
}

export class ListCustomerReceiptsQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsEnum(CustomerReceiptStatus)
    status?: CustomerReceiptStatus

    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string
}

export class CreditManagementQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string
    /** Kế toán phụ trách khách hàng (Party.accountingOwnerEmpId). */
    @IsOptional()
    @IsUUID()
    accountingOwnerEmpId?: string
}

export class AnnualCreditIndicatorsQueryDto {
    @Type(() => Number)
    @IsInt()
    @Min(2000)
    year!: number

    @IsOptional()
    @IsUUID()
    customerPartyId?: string
    /** Kế toán phụ trách khách hàng (Party.accountingOwnerEmpId). */
    @IsOptional()
    @IsUUID()
    accountingOwnerEmpId?: string
}
