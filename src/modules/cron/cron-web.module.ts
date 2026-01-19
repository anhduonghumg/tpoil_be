import { Module } from '@nestjs/common'
import { CronJobsController } from './cron-jobs.controller'
import { CronJobsService } from './cron-jobs.service'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule],
    controllers: [CronJobsController],
    providers: [CronJobsService],
})
export class CronWebModule {}
