import { Global, Module } from '@nestjs/common'
import { PrismaModule } from '../../infra/prisma/prisma.module'
import { CronRunnerService } from './cron-runner.service'
import { CronRouterService } from './cron-router.service'

@Global()
@Module({
    imports: [PrismaModule],
    providers: [CronRunnerService, CronRouterService],
    exports: [CronRunnerService, CronRouterService],
})
export class CronModule {}
