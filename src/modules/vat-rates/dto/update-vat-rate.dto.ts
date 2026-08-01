import { PartialType } from '@nestjs/mapped-types'
import { CreateVatRateDto } from './create-vat-rate.dto'

export class UpdateVatRateDto extends PartialType(CreateVatRateDto) {}
