import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsIn,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'

export class ParseQuickEntryDto {
    @IsString()
    @MaxLength(5000)
    text!: string

    /**
     * The screen decides when AI is worth it: it parses without AI first and only
     * asks again with useAi once the template alone could not fill everything in.
     */
    @IsOptional()
    @IsBoolean()
    useAi?: boolean
}

export class ConfirmQuickEntryLineDto {
    @IsUUID()
    productId!: string

    @IsUUID()
    warehouseId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    quantity!: number

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
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    discountBaseAmount?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    discountAdjustmentAmount?: number

    @IsOptional()
    @IsIn(['TP', 'NCC'])
    supplySource?: 'TP' | 'NCC'

    /** What was pasted, so a manual correction can be remembered as an alias. */
    @IsOptional()
    @IsString()
    productRawText?: string

    @IsOptional()
    @IsString()
    warehouseRawText?: string
}

/** Một mốc phải trả: sau bao nhiêu ngày, theo tỷ lệ hay theo số tiền chốt sẵn. */
export class QuickEntryPaymentPlanDto {
    @Type(() => Number)
    @IsInt()
    @Min(0)
    dueDays!: number

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

export class ConfirmQuickEntryDto {
    @IsOptional()
    @IsUUID()
    logId?: string

    @IsIn(['SINGLE', 'LOT', 'WITHDRAWAL', 'DAY_TRADE'])
    orderKind!: 'SINGLE' | 'LOT' | 'WITHDRAWAL' | 'DAY_TRADE'

    /** Đơn lô: một hóa đơn ngay khi xác nhận, hay xuất dần theo tiến độ rút. */
    @IsOptional()
    @IsIn(['ON_CONFIRMATION', 'ON_WITHDRAWAL'])
    lotInvoiceMode?: 'ON_CONFIRMATION' | 'ON_WITHDRAWAL'

    @IsOptional()
    @IsIn(['SAME_DAY', 'NET_DAYS'])
    paymentTermType?: 'SAME_DAY' | 'NET_DAYS'

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number

    /** Các mốc phải trả; chỉ dùng khi trả chậm. */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => QuickEntryPaymentPlanDto)
    paymentPlans?: QuickEntryPaymentPlanDto[]

    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsDateString()
    orderDate?: string

    @IsOptional()
    @IsString()
    @MaxLength(30)
    vehiclePlate?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    driverName?: string

    @IsOptional()
    @IsString()
    customerRawText?: string

    /** Off by default only if the sale explicitly asks not to remember the spelling. */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    learnAliases?: boolean

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ConfirmQuickEntryLineDto)
    lines!: ConfirmQuickEntryLineDto[]
}
