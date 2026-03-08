import { Module } from '@nestjs/common'
import { DevDriveTestController } from './dev-drive-test.controller'
import { DevDriveTestService } from './dev-drive-test.service'

@Module({
    controllers: [DevDriveTestController],
    providers: [DevDriveTestService],
})
export class DevDriveTestModule {}
