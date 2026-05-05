import { IsOptional, IsString, Matches } from 'class-validator'

export class QueryCommodityPriceQuotesDto {
    @IsString()
    @Matches(/^\d{4}-\d{2}$/, {
        message: 'month must be YYYY-MM',
    })
    month!: string

    @IsOptional()
    @IsString()
    productId?: string
}
