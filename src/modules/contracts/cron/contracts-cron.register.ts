import { Injectable, OnModuleInit } from '@nestjs/common'
import { CronJobType } from '@prisma/client'
import { CronRouterService } from 'src/modules/cron/cron-router.service'
import type { Job } from 'bullmq'
import { ContractExpiryCronService } from './contract-expiry.cron.service'

type Payload = {
    cronRunId: string
    referenceDate: string
    status?: 'all' | 'expiring' | 'expired'
}

@Injectable()
export class ContractsCronRegister implements OnModuleInit {
    constructor(
        private readonly router: CronRouterService,
        private readonly expiry: ContractExpiryCronService,
    ) {}

    onModuleInit(): void {
        this.router.register(CronJobType.CONTRACT_EXPIRY_DAILY, async (job: Job<unknown>): Promise<void> => {
            const payload = job.data as Payload
            await this.expiry.handle(payload)
        })
    }
}
