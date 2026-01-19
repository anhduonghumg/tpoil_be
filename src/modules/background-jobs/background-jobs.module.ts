// src/modules/background-jobs/background-jobs.module.ts
import { Module } from '@nestjs/common'
import { BackgroundJobsService } from './background-jobs.service'
import { QueueModule } from 'src/infra/queue/queue.module'

@Module({
    imports: [QueueModule],
    providers: [BackgroundJobsService],
    exports: [BackgroundJobsService],
})
export class BackgroundJobsModule {}
