import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { BankingController } from './banking.controller'
import { BankingService } from './banking.service'

@Module({
    imports: [PrismaModule],
    controllers: [BankingController],
    providers: [BankingService],
    exports: [BankingService],
})
export class BankingModule {}
