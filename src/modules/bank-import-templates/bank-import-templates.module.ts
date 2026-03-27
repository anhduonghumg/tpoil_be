import { Module } from '@nestjs/common'
import { BankImportTemplatesController } from './bank-import-templates.controller'
import { BankImportTemplatesService } from './bank-import-templates.service'

@Module({
    controllers: [BankImportTemplatesController],
    providers: [BankImportTemplatesService],
    exports: [BankImportTemplatesService],
})
export class BankImportTemplatesModule {}
