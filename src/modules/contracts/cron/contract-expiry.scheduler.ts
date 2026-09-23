import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CronJobType } from '@prisma/client'
import { CronRunnerService } from '../../cron/cron-runner.service'
import { QueueFactory } from '../../../infra/queue/queue.factory'
import { vnDateKey } from 'src/common/utils/date.utils'

@Injectable()
export class ContractExpiryScheduler {
    private readonly logger = new Logger(ContractExpiryScheduler.name)

    constructor(
        private readonly cronRunner: CronRunnerService,
        private readonly qf: QueueFactory,
    ) {}

    @Cron('0 00 09 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
    async handleDaily() {
        const referenceDate = new Date()
        const { runId, runDate, skipped } = await this.cronRunner.beginRun(CronJobType.CONTRACT_EXPIRY_DAILY, referenceDate)

        if (skipped) return

        const queue = this.qf.getQueue('cron')
        const opts = this.qf.jobOpts('default')

        const uniqueJobId = `${CronJobType.CONTRACT_EXPIRY_DAILY}-${runId}`

        await queue.add(
            CronJobType.CONTRACT_EXPIRY_DAILY,
            {
                cronRunId: runId,
                // runDate là 0 giờ theo giờ VN; toISOString sẽ lùi về ngày hôm trước (17 giờ UTC).
                referenceDate: vnDateKey(runDate),
                status: 'all',
            },
            {
                ...opts,
                jobId: `${CronJobType.CONTRACT_EXPIRY_DAILY}-${uniqueJobId}`,
            },
        )
        const waiting = await queue.getWaitingCount()
        const active = await queue.getActiveCount()
        this.logger.log(`cron queue waiting=${waiting} active=${active}`)

        this.logger.log(`Enqueued ${CronJobType.CONTRACT_EXPIRY_DAILY} runId=${runId}`)
    }
}
