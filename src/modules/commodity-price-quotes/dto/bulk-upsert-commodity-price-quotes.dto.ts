import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, IsArray, ValidateNested } from 'class-validator'
import { UpsertCommodityPriceQuoteDto } from './upsert-commodity-price-quote.dto'

/**
 * Dán nhanh giá Platts từ bảng tính: một tháng x vài mặt hàng là cả trăm ô, gọi
 * từng ô một thì vừa chậm vừa có nguy cơ lưu được nửa chừng rồi hỏng. Giới hạn 500
 * ô mỗi lần, đủ cho một quý ba mặt hàng.
 */
export class BulkUpsertCommodityPriceQuotesDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(500)
    @ValidateNested({ each: true })
    @Type(() => UpsertCommodityPriceQuoteDto)
    items!: UpsertCommodityPriceQuoteDto[]
}
