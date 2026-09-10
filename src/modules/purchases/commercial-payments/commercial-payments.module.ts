import { Module } from '@nestjs/common'
import { CommercialPaymentsController } from './commercial-payments.controller'
import { CommercialPaymentsService } from './commercial-payments.service'

@Module({
    controllers: [CommercialPaymentsController],
    providers: [CommercialPaymentsService],
    exports: [CommercialPaymentsService],
})
export class CommercialPaymentsModule {}
