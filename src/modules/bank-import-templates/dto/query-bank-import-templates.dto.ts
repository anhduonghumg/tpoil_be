import { IsBooleanString, IsOptional, IsString } from 'class-validator'

export class QueryBankImportTemplatesDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsString()
    bankCode?: string

    @IsOptional()
    @IsBooleanString()
    isActive?: string
}
