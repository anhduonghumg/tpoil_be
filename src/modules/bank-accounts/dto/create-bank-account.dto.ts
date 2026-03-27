import { Transform } from 'class-transformer'
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateBankAccountDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    bankCode!: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    bankName?: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(100)
    accountNo!: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    accountName?: string

    @IsOptional()
    @IsString()
    @MaxLength(10)
    currency?: string

    @IsOptional()
    @Transform(({ value }): boolean => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    isActive?: boolean
}
