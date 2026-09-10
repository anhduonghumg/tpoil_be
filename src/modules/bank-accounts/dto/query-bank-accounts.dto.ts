import { IsBooleanString, IsOptional, IsString, IsUUID } from 'class-validator'

export class QueryBankAccountsDto {
    @IsOptional()
    @IsUUID()
    legalEntityId?: string

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsBooleanString()
    isActive?: string
}
