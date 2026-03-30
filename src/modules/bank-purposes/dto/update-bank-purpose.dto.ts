import { PartialType } from '@nestjs/mapped-types'
import { CreateBankPurposeDto } from './create-bank-purpose.dto';

export class UpdateBankPurposeDto extends PartialType(CreateBankPurposeDto) {}
