// src/modules/purchases/goods-receipts/dto/confirm-goods-receipt.dto.ts
import { IsOptional, IsString } from 'class-validator'

export class ConfirmGoodsReceiptDto {
    @IsOptional()
    @IsString()
    note?: string
}
