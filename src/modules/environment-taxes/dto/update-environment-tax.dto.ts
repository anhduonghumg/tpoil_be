import { PartialType } from '@nestjs/swagger'
import { CreateEnvironmentTaxDto } from './create-environment-tax.dto'

export class UpdateEnvironmentTaxDto extends PartialType(CreateEnvironmentTaxDto) {}
