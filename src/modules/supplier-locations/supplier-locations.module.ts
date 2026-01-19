import { Module } from '@nestjs/common'
import { SupplierLocationsController } from './supplier-locations.controller'
import { SupplierLocationsService } from './supplier-locations.service'

@Module({
    controllers: [SupplierLocationsController],
    providers: [SupplierLocationsService],
    exports: [SupplierLocationsService],
})
export class SupplierLocationsModule {}
