// src/employees/dto/finance.dto.ts
import { IsOptional, IsString } from 'class-validator'

export class TaxDto {
    @IsOptional() @IsString() pitCode?: string
    @IsOptional() @IsString() siNumber?: string
    @IsOptional() @IsString() hiNumber?: string
}

export class BankingDto {
    @IsOptional() @IsString() bankName?: string
    @IsOptional() @IsString() branch?: string
    @IsOptional() @IsString() accountNumber?: string
    @IsOptional() @IsString() accountHolder?: string
}
