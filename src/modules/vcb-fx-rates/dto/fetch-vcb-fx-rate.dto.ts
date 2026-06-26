import { IsDateString, IsOptional, IsString } from 'class-validator'

export class FetchVcbFxRateDto {
    @IsOptional()
    @IsDateString()
    rateDate?: string

    @IsOptional()
    @IsString()
    currencyCode?: string
}