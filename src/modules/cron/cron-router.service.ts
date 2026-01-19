// src/modules/cron/cron-router.service.ts
import { Injectable } from '@nestjs/common'
import type { Job } from 'bullmq'

export type CronJobHandler = (job: Job<unknown>) => Promise<void>

@Injectable()
export class CronRouterService {
    private handlers = new Map<string, CronJobHandler>()

    register(jobName: string, handler: CronJobHandler): void {
        this.handlers.set(jobName, handler)
    }

    async dispatch(job: Job<unknown>): Promise<void> {
        const h = this.handlers.get(job.name)
        if (!h) return
        await h(job)
    }
}
