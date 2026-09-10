import { Module } from '@nestjs/common'
import { BankImportsController } from './bank-imports.controller'
import { BankImportsService } from './bank-imports.service'
import { BankImportProcessor } from './bank-import.processor'

@Module({
    controllers: [BankImportsController],
    providers: [BankImportsService, BankImportProcessor],
    exports: [BankImportsService],
})
export class BankImportsModule {}
