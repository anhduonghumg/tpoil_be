import { Injectable } from '@nestjs/common'
import { Job } from 'bullmq'
import { PurchaseOrdersService } from '../purchase-orders.service'

@Injectable()
export class PurchaseOrderPrintProcessor {
    constructor(private readonly service: PurchaseOrdersService) {}

    async handle(job: Job) {
        const { runId } = job.data as { runId: string }
        return this.service.handleWorkerJob(runId)
    }
}
