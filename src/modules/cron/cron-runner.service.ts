// src/modules/cron/cron-runner.service.ts
import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { CronJobStatus, CronJobType, Prisma } from '@prisma/client'
import { startOfDay } from 'src/common/utils/date.utils'

type JsonValue = Prisma.InputJsonValue
const toJson = (v: unknown): JsonValue | undefined => {
    if (v === undefined) return undefined
    try {
        return JSON.parse(JSON.stringify(v)) as JsonValue
    } catch {
        return String(v)
    }
}

@Injectable()
export class CronRunnerService {
    private readonly logger = new Logger(CronRunnerService.name)
    constructor(private readonly prisma: PrismaService) {}

    async ensureJob(type: CronJobType) {
        const existing = await this.prisma.cronJob.findUnique({ where: { type } })
        if (existing) return existing

        return this.prisma.cronJob.create({
            data: { type, name: this.defaultNameForType(type), enabled: true },
        })
    }

    /**
     * Idempotent: mỗi job chỉ có 1 run/ngày (runDate = startOfDay).
     * - Nếu đã SUCCESS => return { skipped: true }
     * - Nếu đã FAILED/đang chạy => return existing runId để retry/continue (tuỳ bạn)
     */
    async beginRun(type: CronJobType, referenceDate: Date) {
        const job = await this.ensureJob(type)
        const runDate = startOfDay(referenceDate)
        const now = new Date()

        const run = await this.prisma.$transaction(async (tx) => {
            const existing = await tx.cronJobRun.findFirst({
                where: { jobId: job.id, runDate },
                orderBy: { createdAt: 'desc' },
            })

            if (existing?.status === CronJobStatus.SUCCESS) {
                return { run: existing, skipped: true as const }
            }

            if (existing) {
                return { run: existing, skipped: false as const }
            }

            const created = await tx.cronJobRun.create({
                data: {
                    jobId: job.id,
                    runDate,
                    startedAt: now,
                    status: CronJobStatus.FAILED,
                },
            })

            return { run: created, skipped: false as const }
        })

        this.logger.log(`Cron begin [${type}] runId=${run.run.id} runDate=${runDate.toISOString()} skipped=${run.skipped}`)
        return { runId: run.run.id, runDate, skipped: run.skipped }
    }

    async markSuccess(runId: string, metrics?: unknown) {
        await this.prisma.cronJobRun.update({
            where: { id: runId },
            data: { finishedAt: new Date(), status: CronJobStatus.SUCCESS, metrics: toJson(metrics) },
        })
    }

    async markFailed(runId: string, err: unknown) {
        const msg = err instanceof Error ? err.message.slice(0, 2000) : String(err).slice(0, 2000)
        await this.prisma.cronJobRun.update({
            where: { id: runId },
            data: { finishedAt: new Date(), status: CronJobStatus.FAILED, error: msg },
        })
    }

    async touchStartedAt(runId: string) {
        await this.prisma.cronJobRun.update({
            where: { id: runId },
            data: { startedAt: new Date() },
        })
    }

    private defaultNameForType(type: CronJobType): string {
        switch (type) {
            case CronJobType.CONTRACT_EXPIRY_DAILY:
                return 'Báo cáo hợp đồng sắp/đã hết hạn hằng ngày'
            default:
                return type
        }
    }
}
