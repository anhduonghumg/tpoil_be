import { Injectable } from '@nestjs/common'
import { PrismaService } from '../../infra/prisma/prisma.service'

@Injectable()
export class CronJobsService {
    constructor(private readonly prisma: PrismaService) {}

    async listJobs() {
        const jobs = await this.prisma.cronJob.findMany({
            orderBy: { type: 'asc' },
            include: {
                runs: {
                    orderBy: { runDate: 'desc' },
                    take: 1,
                },
            },
        })

        return jobs.map((job) => {
            const lastRun = job.runs[0]

            return {
                id: job.id,
                type: job.type,
                name: job.name,
                enabled: job.enabled,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
                lastRun: lastRun
                    ? {
                          id: lastRun.id,
                          runDate: lastRun.runDate,
                          startedAt: lastRun.startedAt,
                          finishedAt: lastRun.finishedAt,
                          status: lastRun.status,
                          error: lastRun.error,
                      }
                    : null,
            }
        })
    }

    async listRunsByJob(jobId: string, page = 1, pageSize = 20) {
        const skip = (page - 1) * pageSize

        const [items, total] = await this.prisma.$transaction([
            this.prisma.cronJobRun.findMany({
                where: { jobId },
                orderBy: { runDate: 'desc' },
                skip,
                take: pageSize,
            }),
            this.prisma.cronJobRun.count({ where: { jobId } }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
        }
    }
}
