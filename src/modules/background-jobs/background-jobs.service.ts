// src/modules/background-jobs/background-jobs.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { BackgroundJobStatus, BackgroundJobType, Prisma } from '@prisma/client'
import { QueueFactory, type JobProfile } from 'src/infra/queue/queue.factory'

type JsonValue = Prisma.InputJsonValue
function toJsonValue(v: unknown): JsonValue | undefined {
    if (v === undefined) return undefined
    try {
        return JSON.parse(JSON.stringify(v)) as JsonValue
    } catch {
        return String(v) as unknown as JsonValue
    }
}

@Injectable()
export class BackgroundJobsService {
    private readonly logger = new Logger(BackgroundJobsService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly qf: QueueFactory,
    ) {}

    async ensureJob(type: BackgroundJobType, name: string) {
        const existing = await this.prisma.backgroundJob.findUnique({ where: { type } })
        if (existing) return existing
        return this.prisma.backgroundJob.create({ data: { type, name, enabled: true } })
    }

    async createRun(args: { type: BackgroundJobType; name: string; payload?: unknown }) {
        const job = await this.ensureJob(args.type, args.name)
        return this.prisma.backgroundJobRun.create({
            data: {
                jobId: job.id,
                status: BackgroundJobStatus.PENDING,
                payload: toJsonValue(args.payload),
            },
            select: { id: true },
        })
    }

    async enqueueRun(args: { type: BackgroundJobType; queueName: string; runId: string; payloadRef?: Record<string, any>; jobId?: string; profile?: JobProfile }) {
        const queue = this.qf.getQueue(args.queueName)
        const opts = this.qf.jobOpts(args.profile ?? 'default')

        await queue.add(
            args.type,
            {
                runId: args.runId,
                payloadRef: args.payloadRef ?? {},
            },
            opts,
        )

        this.logger.log(`Enqueued ${args.type} runId=${args.runId} queue=${args.queueName}`)
        return { runId: args.runId }
    }

    async markProcessing(runId: string): Promise<void> {
        await this.prisma.backgroundJobRun.update({
            where: { id: runId },
            data: { status: BackgroundJobStatus.PROCESSING, startedAt: new Date() },
        })
    }

    async markSuccess(runId: string, metrics?: unknown): Promise<void> {
        await this.prisma.backgroundJobRun.update({
            where: { id: runId },
            data: { status: BackgroundJobStatus.SUCCESS, finishedAt: new Date(), metrics: toJsonValue(metrics) },
        })
    }

    async markFailed(runId: string, err: unknown): Promise<void> {
        const msg = err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000)
        await this.prisma.backgroundJobRun.update({
            where: { id: runId },
            data: { status: BackgroundJobStatus.FAILED, finishedAt: new Date(), error: msg },
        })
    }

    async updateMetrics(runId: string, metrics: unknown): Promise<void> {
        await this.prisma.backgroundJobRun.update({
            where: { id: runId },
            data: {
                metrics: metrics ? toJsonValue(metrics) : undefined,
            },
        })
    }
}
