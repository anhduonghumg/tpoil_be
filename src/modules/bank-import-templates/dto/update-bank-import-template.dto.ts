import { PartialType } from '@nestjs/mapped-types'
import { CreateBankImportTemplateDto } from './create-bank-import-template.dto'

export class UpdateBankImportTemplateDto extends PartialType(CreateBankImportTemplateDto) {}
