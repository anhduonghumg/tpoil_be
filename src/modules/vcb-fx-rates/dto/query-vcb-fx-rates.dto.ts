import { IsOptional, IsString, Matches } from 'class-validator'

export class QueryVcbFxRatesDto {
    @IsString()
    @Matches(/^\d{4}-\d{2}$/, {
        message: 'month must be YYYY-MM',
    })
    month!: string

    @IsOptional()
    @IsString()
    bankCode?: string

    @IsOptional()
    @IsString()
    currencyCode?: string
}
