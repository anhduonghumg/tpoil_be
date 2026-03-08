import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common'
import { Worker } from 'bullmq'
import { QueueFactory } from 'src/infra/queue/queue.factory'
import { QB_SUPPLIER_INVOICE } from './jobs/supplier-invoice-queues'
import { SupplierInvoiceProcessor } from './jobs/supplier-invoice.processor'

@Injectable()
export class SupplierInvoiceWorker implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(SupplierInvoiceWorker.name)
    private worker?: Worker

    constructor(
        private readonly qf: QueueFactory,
        private readonly processor: SupplierInvoiceProcessor,
    ) {}

    onApplicationBootstrap() {
        this.worker = this.qf.createWorker(QB_SUPPLIER_INVOICE, async (job) => this.processor.handle(job), { concurrency: 2 })

        this.worker.on('ready', () => this.logger.log(`Worker listening: ${QB_SUPPLIER_INVOICE}`))
        this.worker.on('failed', (job, err) => this.logger.error(`Job ${job?.id} failed: ${err.message}`))
    }

    async onModuleDestroy() {
        await this.worker?.close()
    }
}
