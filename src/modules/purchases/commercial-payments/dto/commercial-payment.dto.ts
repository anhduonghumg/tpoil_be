import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateCommercialPaymentRequestDto {
    @IsUUID()
    supplierInvoiceId!: string

    @IsOptional()
    @IsDateString()
    paymentDeadline?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsUUID()
    beneficiaryBankAccountId?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountNo?: string
}

export class PaymentRequestDecisionDto {
    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountNo?: string
}

export class RecordCommercialPaymentDto {
    @IsOptional()
    @IsIn(['OWN_BANK', 'DIRECT_DISBURSEMENT'])
    fundingSource?: 'OWN_BANK' | 'DIRECT_DISBURSEMENT'

    @IsOptional()
    @IsUUID()
    sourceBankAccountId?: string

    @IsOptional()
    @IsString()
    lenderBankName?: string

    @IsOptional()
    @IsString()
    creditFacilityRef?: string

    @IsOptional()
    @IsString()
    disbursementNo?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amountVnd!: number

    @IsDateString()
    paidAt!: string

    @IsOptional()
    @IsString()
    proofFileUrl?: string

    @IsOptional()
    @IsString()
    proofFileName?: string

    @IsOptional()
    @IsString()
    note?: string
}
