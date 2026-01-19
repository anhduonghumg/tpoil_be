import { Module } from '@nestjs/common'
import { ContractExpiryScheduler } from './contract-expiry.scheduler'
import { QueueModule } from 'src/infra/queue/queue.module'
import { CronModule } from 'src/modules/cron/cron.module'

@Module({
    imports: [QueueModule, CronModule],
    providers: [ContractExpiryScheduler],
})
export class ContractsSchedulerModule {}
