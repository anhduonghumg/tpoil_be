import { Module } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SalesOrdersController } from './sales-orders.controller'
import { SalesOrdersService } from './sales-orders.service'

@Module({
    controllers: [SalesOrdersController],
    providers: [SalesOrdersService, PrismaService],
    exports: [SalesOrdersService],
})
export class SalesOrdersModule {}
