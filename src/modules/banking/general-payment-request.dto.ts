import { Type } from 'class-transformer'
import {
    IsDateString,
    IsEnum,
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
} from 'class-validator'
import { GeneralPaymentRequestCategory } from '@prisma/client'

export class CreateGeneralPaymentRequestDto {
    @IsDateString()
    requestDate!: string

    @IsEnum(GeneralPaymentRequestCategory)
    category!: GeneralPaymentRequestCategory

    @IsString()
    beneficiaryName!: string

    @IsOptional()
    @IsString()
    beneficiaryTaxCode?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountNo?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountName?: string

    @IsOptional()
    @IsString()
    beneficiaryBankName?: string

    @IsString()
    content!: string

    @IsOptional()
    @IsString()
    referenceNo?: string

    @IsOptional()
    @IsString()
    invoiceNo?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amountVnd!: number

    @IsOptional()
    @IsDateString()
    paymentDeadline?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class GeneralPaymentRequestDecisionDto {
    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountNo?: string

    @IsOptional()
    @IsString()
    beneficiaryAccountName?: string

    @IsOptional()
    @IsString()
    beneficiaryBankName?: string
}

export class RecordGeneralPaymentDto {
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

export class MatchGeneralPaymentReconciliationDto {
    @IsUUID()
    paymentId!: string

    @IsOptional()
    @IsString()
    note?: string
}

export class ReverseGeneralPaymentReconciliationDto {
    @IsString()
    reason!: string
}
