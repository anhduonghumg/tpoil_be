import { BankTxnDirection, CounterpartyType } from '@prisma/client'
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateBankPurposeDto {
    @IsString()
    @MaxLength(50)
    code!: string

    @IsString()
    @MaxLength(150)
    name!: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    description?: string

    @IsOptional()
    @IsEnum(BankTxnDirection)
    direction?: BankTxnDirection

    @IsOptional()
    @IsString()
    @MaxLength(50)
    module?: string

    @IsOptional()
    @IsEnum(CounterpartyType)
    counterpartyType?: CounterpartyType

    @IsOptional()
    @IsBoolean()
    affectsDebt?: boolean

    @IsOptional()
    @IsBoolean()
    isSystem?: boolean

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number
}
