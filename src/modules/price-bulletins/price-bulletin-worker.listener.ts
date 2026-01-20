// src/modules/price-bulletins/price-bulletin-worker.listener.ts
import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common'
import { Worker } from 'bullmq'
import { QueueFactory } from 'src/infra/queue/queue.factory'
import { PriceBulletinProcessor } from './jobs/price-bulletin.processor'
import { QB_PRICE_BULLETIN } from './jobs/price-bulletin-queues'

@Injectable()
export class PriceBulletinWorker implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(PriceBulletinWorker.name)
    private worker?: Worker

    constructor(
        private readonly qf: QueueFactory,
        private readonly processor: PriceBulletinProcessor,
    ) {}

    onApplicationBootstrap() {
        this.worker = this.qf.createWorker(QB_PRICE_BULLETIN, async (job) => this.processor.handle(job), { concurrency: 2 })

        this.worker.on('ready', () => this.logger.log(`Worker lắng nghe hàng đợi: ${QB_PRICE_BULLETIN}`))
        this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} thất bại: ${err.message}`))
    }

    async onModuleDestroy() {
        await this.worker?.close()
    }
}
