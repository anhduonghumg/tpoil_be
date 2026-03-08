import { Injectable } from '@nestjs/common'
import { Job } from 'bullmq'
import { SupplierInvoicesService } from '../supplier-invoices.service'

@Injectable()
export class SupplierInvoiceProcessor {
    constructor(private readonly service: SupplierInvoicesService) {}

    async handle(job: Job) {
        const { runId } = job.data as { runId: string }
        return this.service.handleWorkerJob(runId)
    }
}
