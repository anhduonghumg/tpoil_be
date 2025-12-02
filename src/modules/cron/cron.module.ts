import { Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { CronRunnerService } from './cron-runner.service'
import { CronJobsService } from './cron-jobs.service'
import { CronJobsController } from './cron-jobs.controller'

@Module({
    imports: [PrismaModule],
    controllers: [CronJobsController],
    providers: [CronRunnerService, CronJobsService],
    exports: [CronRunnerService, CronJobsService],
})
export class CronModule {}
