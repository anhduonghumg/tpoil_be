import { Module } from '@nestjs/common'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { EnvironmentTaxesController } from './environment-taxes.controller'
import { EnvironmentTaxesService } from './environment-taxes.service'

@Module({
    imports: [PrismaModule],
    controllers: [EnvironmentTaxesController],
    providers: [EnvironmentTaxesService],
    exports: [EnvironmentTaxesService],
})
export class EnvironmentTaxesModule {}
