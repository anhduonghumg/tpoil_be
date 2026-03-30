import { Module } from '@nestjs/common'
import { BankPurposesController } from './bank-purposes.controller'
import { BankPurposesService } from './bank-purposes.service'

@Module({
    controllers: [BankPurposesController],
    providers: [BankPurposesService],
    exports: [BankPurposesService],
})
export class BankPurposesModule {}
