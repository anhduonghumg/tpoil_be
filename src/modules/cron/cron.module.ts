import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { CronRunnerService } from './cron-runner.service'
import { DemoCron } from './demo.cron'

@Module({
    imports: [PrismaModule],
    providers: [CronRunnerService, DemoCron],
    exports: [CronRunnerService],
})
export class CronModule {}
