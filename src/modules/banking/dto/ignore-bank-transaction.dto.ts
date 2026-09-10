import { IsOptional, IsString, MaxLength } from 'class-validator'

export class IgnoreBankTransactionDto {
    @IsOptional()
    @IsString()
    @MaxLength(500)
    reason?: string
}
