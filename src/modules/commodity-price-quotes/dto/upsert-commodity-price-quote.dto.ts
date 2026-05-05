import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class UpsertCommodityPriceQuoteDto {
    @IsUUID()
    productId!: string

    @IsDateString()
    quoteDate!: string

    @IsNumber()
    @Min(0)
    priceUsdPerBbl!: number

    @IsOptional()
    @IsString()
    note?: string
}
