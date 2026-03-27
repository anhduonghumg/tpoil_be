import { IsBooleanString, IsOptional, IsString } from 'class-validator'

export class QueryBankAccountsDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsBooleanString()
    isActive?: string
}
