import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator'

export class ReconcileCommercialPaymentDto {
    @IsUUID()
    paymentId!: string

    /** Bỏ trống: ghép phần nhỏ hơn giữa phần còn lại của giao dịch và của lần chi. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amountVnd?: number

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class RecordCommercialFromStatementDto {
    @IsUUID()
    paymentRequestId!: string

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class ReverseCommercialReconciliationDto {
    @IsString()
    @MinLength(3)
    @MaxLength(500)
    reason!: string
}

export class RecognizeBankTransactionsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @IsUUID('all', { each: true })
    ids!: string[]
}

/** Bỏ qua nhiều dòng một lần: chuyển nội bộ giữa các tài khoản công ty, phí / lãi ngân hàng. */
export class IgnoreBankTransactionsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @IsUUID('all', { each: true })
    ids!: string[]

    @IsIn(['INTERNAL', 'OTHER'])
    counterpartyType!: 'INTERNAL' | 'OTHER'

    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string
}
