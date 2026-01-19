import { Module } from '@nestjs/common'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from './infra/prisma/prisma.module'
import { QueueModule } from './infra/queue/queue.module'
import { AppLoggingModule } from './infra/logging/logging.module'
import { ContractsSchedulerModule } from './modules/contracts/cron/contracts-scheduler.module'

@Module({
    imports: [ScheduleModule.forRoot(), PrismaModule, QueueModule, AppLoggingModule, ContractsSchedulerModule],
})
export class SchedulerModule {}
