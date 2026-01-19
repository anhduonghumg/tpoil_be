// src/infra/queue/queue.factory.ts
import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import { Queue, Worker, type JobsOptions, type WorkerOptions, type Processor } from 'bullmq'
import type IORedis from 'ioredis'
import { QUEUE_CONN } from './queue.tokens'
import { createRedisConnection } from '../redis/redis.connection'

export type JobProfile = 'default' | 'pdf_parse'

@Injectable()
export class QueueFactory implements OnModuleDestroy {
    private queues = new Map<string, Queue>()
    private workerConns = new Map<string, IORedis>()

    constructor(@Inject(QUEUE_CONN) private readonly conn: IORedis) {}

    getQueue(name: string) {
        const existing = this.queues.get(name)
        if (existing) return existing
        const q = new Queue(name, { connection: this.conn })
        this.queues.set(name, q)
        return q
    }

    createWorker<TPayload = any, TResult = any>(name: string, processor: Processor<TPayload, TResult, string>, opts?: Omit<WorkerOptions, 'connection'>) {
        let connection = this.workerConns.get(name)

        if (!connection) {
            connection = createRedisConnection()
            this.workerConns.set(name, connection)
            console.log(`📡 [QueueFactory] Created new Redis connection for Worker: ${name}`)
        }

        return new Worker<TPayload, TResult, string>(name, processor, {
            connection,
            ...opts,
        })
    }

    async onModuleDestroy() {
        for (const conn of this.workerConns.values()) {
            await conn.quit()
        }
        for (const q of this.queues.values()) {
            await q.close()
        }
    }

    defaultJobOpts(): JobsOptions {
        return {
            attempts: 5,
            backoff: { type: 'exponential', delay: 1500 },
            removeOnComplete: { count: 500 },
            removeOnFail: { count: 1000 },
        }
    }

    jobOpts(profile: JobProfile = 'default'): JobsOptions {
        if (profile === 'pdf_parse') {
            return {
                attempts: 2,
                backoff: { type: 'exponential', delay: 800 },
                removeOnComplete: { count: 200 },
                removeOnFail: { count: 500 },
            }
        }
        return this.defaultJobOpts()
    }
}
