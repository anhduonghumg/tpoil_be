import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Worker } from 'bullmq'
import { QueueFactory } from 'src/infra/queue/queue.factory'
import { QB_PRICE_BULLETIN } from './price-bulletin-queues'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { PriceBulletinsService } from '../price-bulletins.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'

@Injectable()
export class PriceBulletinWorker implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PriceBulletinWorker.name)
    private worker?: Worker

    constructor(
        private readonly qf: QueueFactory,
        private readonly bg: BackgroundJobsService,
        private readonly service: PriceBulletinsService,
        private readonly artifacts: JobArtifactsService,
    ) {}

    onModuleInit() {
        // this.worker = this.qf.createWorker(
        //     QB_PRICE_BULLETIN,
        //     async (job) => {
        //         const { runId, payloadRef } = job.data as any
        //         console.log('[PICK]', {
        //             queue: job.queueName,
        //             bullId: job.id,
        //             name: job.name,
        //             runId,
        //             payloadRefKeys: Object.keys(payloadRef ?? {}),
        //         })
        //         await this.bg.markProcessing(runId)
        //         try {
        //             const key = payloadRef?.artifactKey
        //             if (!key) throw new Error('MISSING_ARTIFACT_KEY')
        //             const buffer = await this.artifacts.readBuffer(key)
        //             const result = await this.service.parseAndMapPdf(buffer)
        //             await this.bg.markSuccess(runId, result)
        //             return result
        //         } catch (e) {
        //             await this.bg.markFailed(runId, e)
        //             throw e
        //         }
        //     },
        //     { concurrency: 2 },
        // )
        // this.worker.on('ready', () => this.logger.log(`[READY] queue=${QB_PRICE_BULLETIN}`))
        // this.logger.log(`[ATTACHED] queue=${QB_PRICE_BULLETIN}`)
    }

    async onModuleDestroy() {
        await this.worker?.close()
    }
}
