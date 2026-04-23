import { PartialType } from '@nestjs/mapped-types'
import { CreateTermReceiptDto } from './create-term-receipt.dto'

export class UpdateTermReceiptDto extends PartialType(CreateTermReceiptDto) {}
