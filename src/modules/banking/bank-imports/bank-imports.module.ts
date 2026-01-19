import { Module } from '@nestjs/common'
import { BankImportsController } from './bank-imports.controller'
import { BankImportsService } from './bank-imports.service'
import { BankImportProcessor } from './bank-import.processor'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Module({
    controllers: [BankImportsController],
    providers: [PrismaService, BankImportsService, BankImportProcessor],
    exports: [BankImportsService],
})
export class BankImportsModule {}
