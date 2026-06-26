import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { VcbFxRatesController } from './vcb-fx-rates.controller'
import { VcbFxRatesService } from './vcb-fx-rates.service'

@Module({
    imports: [PrismaModule],
    controllers: [VcbFxRatesController],
    providers: [VcbFxRatesService],
    exports: [VcbFxRatesService],
})
export class VcbFxRatesModule {}
