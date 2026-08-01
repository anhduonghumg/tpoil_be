import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { VatRatesController } from './vat-rates.controller'
import { VatRatesService } from './vat-rates.service'

@Module({
    imports: [PrismaModule],
    controllers: [VatRatesController],
    providers: [VatRatesService],
})
export class VatRatesModule {}
