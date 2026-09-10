import { Module } from '@nestjs/common'
import { CommercialRetailController } from './commercial-retail.controller'
import { CommercialRetailService } from './commercial-retail.service'

@Module({
    controllers: [CommercialRetailController],
    providers: [CommercialRetailService],
    exports: [CommercialRetailService],
})
export class CommercialRetailModule {}
