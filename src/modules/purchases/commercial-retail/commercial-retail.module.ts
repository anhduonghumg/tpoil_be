import { Module } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CommercialRetailController } from './commercial-retail.controller'
import { CommercialRetailService } from './commercial-retail.service'

@Module({
    controllers: [CommercialRetailController],
    providers: [CommercialRetailService, PrismaService],
    exports: [CommercialRetailService],
})
export class CommercialRetailModule {}
