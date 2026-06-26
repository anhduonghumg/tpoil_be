import { IsDateString, IsNumber, IsOptional, IsString, Min } from 'class-validator'

export class UpsertVcbFxRateDto {
    @IsDateString()
    rateDate!: string

    @IsOptional()
    @IsString()
    bankCode?: string

    @IsString()
    currencyCode!: string

    @IsOptional()
    @IsNumber()
    @Min(0)
    cashBuyRate?: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    transferBuyRate?: number

    @IsNumber()
    @Min(0)
    sellRate!: number

    @IsOptional()
    @IsString()
    note?: string
}
