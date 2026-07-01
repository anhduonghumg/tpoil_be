import { TermBankInstructionStatus, TermSettlementAdjustmentType } from '@prisma/client'
import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateTermPaymentRequestDto {
    @IsOptional()
    @IsString()
    requestNo?: string

    @IsOptional()
    @IsDateString()
    requestDate?: string

    @IsOptional()
    @IsNumber()
    amountVnd?: number

    @IsOptional()
    @IsDateString()
    paymentDeadline?: string

    @IsOptional()
    @IsString()
    content?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class CreateTermBankInstructionDto {
    @IsOptional()
    @IsUUID()
    paymentRequestId?: string

    @IsOptional()
    @IsString()
    instructionNo?: string

    @IsOptional()
    @IsDateString()
    instructionDate?: string

    @IsOptional()
    @IsNumber()
    amountVnd?: number

    @IsOptional()
    @IsString()
    beneficiaryName?: string

    @IsOptional()
    @IsString()
    beneficiaryBankAccount?: string

    @IsOptional()
    @IsString()
    beneficiaryBankName?: string

    @IsOptional()
    @IsString()
    content?: string

    @IsOptional()
    @IsEnum(TermBankInstructionStatus)
    status?: TermBankInstructionStatus

    @IsOptional()
    @IsString()
    note?: string
}

export class MatchTermBankInstructionDto {
    @IsOptional()
    @IsUUID()
    bankTransactionId?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class CreateTermSettlementAdjustmentDto {
    @IsOptional()
    @IsEnum(TermSettlementAdjustmentType)
    adjustmentType?: TermSettlementAdjustmentType

    @IsOptional()
    @IsNumber()
    amountVnd?: number

    @IsOptional()
    @IsString()
    reason?: string

    @IsOptional()
    @IsString()
    note?: string
}
