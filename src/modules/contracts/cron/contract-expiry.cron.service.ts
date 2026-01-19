import { Injectable, Logger } from '@nestjs/common'
import { ContractsService } from '../contracts.service'
import { CronRunnerService } from '../../cron/cron-runner.service'

type Payload = {
    cronRunId: string
    referenceDate: string
    status?: 'all' | 'expiring' | 'expired'
}

@Injectable()
export class ContractExpiryCronService {
    private readonly logger = new Logger(ContractExpiryCronService.name)

    constructor(
        private readonly cronRunner: CronRunnerService,
        private readonly contractsService: ContractsService,
    ) {}

    async handle(payload: Payload): Promise<void> {
        const { cronRunId, referenceDate, status = 'all' } = payload

        try {
            const summary = await this.contractsService.sendContractExpiryEmail({
                referenceDate,
                status,
                to: this.getDefaultRecipients(),
            })

            await this.cronRunner.markSuccess(cronRunId, {
                referenceDate: summary.summary.referenceDate,
                expiringCount: summary.summary.expiringCount,
                expiredCount: summary.summary.expiredCount,
                to: summary.sentTo,
                cc: summary.cc,
            })

            this.logger.log(`SUCCESS runId=${cronRunId} ref=${referenceDate}`)
        } catch (e) {
            await this.cronRunner.markFailed(cronRunId, e)
            this.logger.error(`FAILED runId=${cronRunId} ref=${referenceDate}`, e instanceof Error ? e.stack : undefined)
            throw e
        }
    }

    private getDefaultRecipients(): string[] {
        const raw = process.env.CONTRACT_EXPIRY_EMAIL_TO || ''
        return raw
            .split(/[,;\s]+/)
            .map((x) => x.trim())
            .filter(Boolean)
    }
}
