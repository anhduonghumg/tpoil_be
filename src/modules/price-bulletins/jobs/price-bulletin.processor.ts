// src/modules/price-bulletins/jobs/price-bulletin.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq'
import { Job } from 'bullmq'
import { PriceBulletinsService } from '../price-bulletins.service'
import { QB_PRICE_BULLETIN, ARTIFACT_PRICE_PDF_PREVIEW, ARTIFACT_PRICE_PDF_INPUT } from './price-bulletin-queues'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'

@Processor(QB_PRICE_BULLETIN)
export class PriceBulletinProcessor extends WorkerHost {
    constructor(
        private readonly service: PriceBulletinsService,
        private readonly bg: BackgroundJobsService,
        private readonly artifacts: JobArtifactsService,
    ) {
        super()
    }

    async process(job: Job) {
        const { runId } = job.data as { runId: string; payloadRef: { checksum: string } }
        // console.log(`[PICK] queue=${job.queueName} name=${job.name} bullId=${job.id} dataKeys=${Object.keys(job.data || {}).join(',')}`)

        await this.bg.markProcessing(runId)

        try {
            const input = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_INPUT)
            if (!input?.content) throw new Error('Missing PRICE_PDF_INPUT artifact')

            const content: any = input.content
            const b64 = content.bufferBase64
            if (!b64) throw new Error('Missing bufferBase64 in PRICE_PDF_INPUT artifact')

            const buffer = Buffer.from(String(b64), 'base64')

            const preview = await this.service.parseAndMapPdf(buffer)

            await this.artifacts.upsertArtifact({
                runId,
                kind: ARTIFACT_PRICE_PDF_PREVIEW,
                checksum: input.checksum ?? undefined,
                content: preview,
            })

            await this.artifacts.deleteArtifact(runId, ARTIFACT_PRICE_PDF_INPUT)

            const metrics = {
                checksum: input.checksum ?? null,
                effectiveFrom: preview.effectiveFrom,
                stats: preview.stats ?? null,
                conflict: preview.conflict ?? null,
            }

            await this.bg.markSuccess(runId, metrics)
            return metrics
        } catch (err) {
            await this.artifacts.deleteArtifact(runId, ARTIFACT_PRICE_PDF_INPUT).catch(() => null)

            await this.bg.markFailed(runId, err)
            throw err
        }
    }
}
