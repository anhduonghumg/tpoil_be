import { PartialType } from '@nestjs/mapped-types'
import { CreateTermGoodsReceiptDto } from './create-term-goods-receipt.dto'

export class UpdateTermGoodsReceiptDto extends PartialType(CreateTermGoodsReceiptDto) {}
