import { Injectable, OnApplicationBootstrap, OnModuleDestroy, Logger } from '@nestjs/common'
import { Worker } from 'bullmq'
import { QueueFactory } from 'src/infra/queue/queue.factory'
import { PurchaseOrderPrintProcessor } from './jobs/purchase-order-print.processor'
import { QB_PURCHASE_ORDER_PRINT } from './jobs/purchase-order-print-queues'

@Injectable()
export class PurchaseOrdersWorker implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(PurchaseOrdersWorker.name)
    private worker?: Worker

    constructor(
        private readonly qf: QueueFactory,
        private readonly processor: PurchaseOrderPrintProcessor,
    ) {}

    onApplicationBootstrap() {
        this.worker = this.qf.createWorker(QB_PURCHASE_ORDER_PRINT, async (job) => this.processor.handle(job), { concurrency: 2 })

        this.worker.on('ready', () => this.logger.log(`Worker lắng nghe hàng đợi: ${QB_PURCHASE_ORDER_PRINT}`))

        this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} thất bại: ${err.message}`))
    }

    async onModuleDestroy() {
        await this.worker?.close()
    }
}
