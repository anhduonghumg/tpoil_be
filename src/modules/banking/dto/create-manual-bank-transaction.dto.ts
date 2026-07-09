import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateManualBankTransactionDto {
    @IsUUID()
    bankAccountId!: string

    @IsDateString()
    txnDate!: string

    @IsIn(['IN', 'OUT'])
    direction!: 'IN' | 'OUT'

    @Type(() => Number)
    @IsNumber()
    @Min(0.01)
    amount!: number

    @IsString()
    description!: string

    @IsOptional()
    @IsString()
    counterpartyName?: string

    @IsOptional()
    @IsString()
    counterpartyAcc?: string

    @IsOptional()
    @IsString()
    externalRef?: string

    @IsOptional()
    @IsString()
    documentCode?: string

    @IsOptional()
    @IsString()
    purposeRaw?: string

    @IsOptional()
    @IsUUID()
    purposeId?: string

    @IsOptional()
    @IsString()
    note?: string
}
