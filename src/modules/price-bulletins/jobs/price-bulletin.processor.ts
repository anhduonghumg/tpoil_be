// src/modules/price-bulletins/jobs/price-bulletin.processor.ts
import { Injectable } from '@nestjs/common'
import { Job } from 'bullmq'
import { PriceBulletinsService } from '../price-bulletins.service'

@Injectable()
export class PriceBulletinProcessor {
    constructor(private readonly service: PriceBulletinsService) {}

    async handle(job: Job) {
        const { runId } = job.data as { runId: string }
        return this.service.handleWorkerJob(runId)
    }
}
