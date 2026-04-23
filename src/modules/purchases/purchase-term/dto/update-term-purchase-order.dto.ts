import { PartialType } from '@nestjs/mapped-types'
import { CreateTermPurchaseOrderDto } from './create-term-purchase-order.dto'

export class UpdateTermPurchaseOrderDto extends PartialType(CreateTermPurchaseOrderDto) {}
