import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { CronJobStatus, CronJobType, Prisma } from '@prisma/client'

@Injectable()
export class CronRunnerService {
    private readonly logger = new Logger(CronRunnerService.name)

    constructor(private readonly prisma: PrismaService) {}

    async runJob<TMetrics = any>(type: CronJobType, runDate: Date, handler: () => Promise<TMetrics>) {
        const job = await this.ensureJob(type)

        const now = new Date()
        const run = await this.prisma.cronJobRun.create({
            data: {
                jobId: job.id,
                runDate,
                startedAt: now,
                status: CronJobStatus.FAILED,
            },
        })

        this.logger.log(`Start cron job [${type}] runId=${run.id}`)

        try {
            const metrics = await handler()

            await this.prisma.cronJobRun.update({
                where: { id: run.id },
                data: {
                    finishedAt: new Date(),
                    status: CronJobStatus.SUCCESS,
                    metrics: metrics == null ? undefined : (metrics as Prisma.InputJsonValue),
                },
            })

            this.logger.log(`Cron job [${type}] runId=${run.id} SUCCESS: ${JSON.stringify(metrics)}`)

            return { runId: run.id, metrics }
        } catch (err) {
            const msg = err instanceof Error ? err.message.slice(0, 2000) : String(err)

            await this.prisma.cronJobRun.update({
                where: { id: run.id },
                data: {
                    finishedAt: new Date(),
                    status: CronJobStatus.FAILED,
                    error: msg,
                },
            })

            this.logger.error(`Cron job [${type}] runId=${run.id} FAILED: ${msg}`, err instanceof Error ? err.stack : undefined)

            throw err
        }
    }

    private async ensureJob(type: CronJobType) {
        const existing = await this.prisma.cronJob.findUnique({
            where: { type },
        })
        if (existing) return existing

        return this.prisma.cronJob.create({
            data: {
                type,
                name: this.defaultNameForType(type),
                enabled: true,
            },
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
