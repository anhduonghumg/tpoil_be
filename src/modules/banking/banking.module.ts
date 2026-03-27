import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { BankingController } from './banking.controller'
import { BankingService } from './banking.service'
import { BankImportTemplatesModule } from '../bank-import-templates/bank-import-templates.module'

@Module({
    imports: [PrismaModule, BankImportTemplatesModule],
    controllers: [BankingController],
    providers: [BankingService],
    exports: [BankingService],
})
export class BankingModule {}
