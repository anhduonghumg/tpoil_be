import { Module } from '@nestjs/common'
import { CronListener } from './cron.listener'

@Module({
    providers: [CronListener],
})
export class CronWorkerModule {}
