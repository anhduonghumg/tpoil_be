// src/infra/queue/queue.module.ts
import { Global, Module } from '@nestjs/common'
import { QUEUE_CONN } from './queue.tokens'
import { createRedisConnection } from '../redis/redis.connection'
import { QueueFactory } from './queue.factory'

@Global()
@Module({
    providers: [{ provide: QUEUE_CONN, useFactory: () => createRedisConnection() }, QueueFactory],
    exports: [QUEUE_CONN, QueueFactory],
})
export class QueueModule {}
