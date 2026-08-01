import { Module } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CommercialPaymentsController } from './commercial-payments.controller'
import { CommercialPaymentsService } from './commercial-payments.service'

@Module({
    controllers: [CommercialPaymentsController],
    providers: [CommercialPaymentsService, PrismaService],
    exports: [CommercialPaymentsService],
})
export class CommercialPaymentsModule {}
