import { Injectable, Logger } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { CronJobType } from '@prisma/client'
import { ContractsService } from './contracts.service'
import { CronRunnerService } from '../cron/cron-runner.service'

@Injectable()
export class ContractExpiryCronService {
    private readonly logger = new Logger(ContractExpiryCronService.name)

    constructor(
        private readonly cronRunner: CronRunnerService,
        private readonly contractsService: ContractsService,
    ) {}

    // Chạy lúc 8h sáng mỗi ngày, giờ VN
    @Cron('0 9 * * *', { timeZone: 'Asia/Ho_Chi_Minh' })
    async handleDaily() {
        const runDate = new Date()

        this.logger.log(`Trigger CONTRACT_EXPIRY_DAILY at ${runDate.toISOString()}`)

        await this.cronRunner.runJob(CronJobType.CONTRACT_EXPIRY_DAILY, runDate, async () => {
            const ref = runDate.toISOString().slice(0, 10)

            const summary = await this.contractsService.sendContractExpiryEmail({
                referenceDate: ref,
                status: 'all',
                to: this.getDefaultRecipients(),
            })

            return {
                referenceDate: summary.summary.referenceDate,
                expiringCount: summary.summary.expiringCount,
                expiredCount: summary.summary.expiredCount,
                to: summary.sentTo,
                cc: summary.cc,
            }
        })
    }

    private getDefaultRecipients(): string[] {
        const raw = process.env.CONTRACT_EXPIRY_EMAIL_TO || ''
        return raw
            .split(/[,;\s]+/)
            .map((x) => x.trim())
            .filter(Boolean)
    }
}
