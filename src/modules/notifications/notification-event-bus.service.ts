import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { filter, map, Observable, Subject } from 'rxjs'
import type { MessageEvent } from '@nestjs/common'
import type IORedis from 'ioredis'
import { createRedisConnection } from 'src/infra/redis/redis.connection'

type NotificationSignal = {
    notificationId: string
    userIds: string[]
    occurredAt: string
}

const CHANNEL = 'common-notifications'

@Injectable()
export class NotificationEventBus implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NotificationEventBus.name)
    private readonly signals = new Subject<NotificationSignal>()
    private publisher?: IORedis
    private subscriber?: IORedis

    private withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
        return Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), timeoutMs)
                timer.unref?.()
            }),
        ])
    }

    async onModuleInit() {
        this.publisher = createRedisConnection('notify:pub')
        this.subscriber = createRedisConnection('notify:sub')
        this.subscriber.on('message', (_channel, raw) => {
            try {
                this.signals.next(JSON.parse(raw) as NotificationSignal)
            } catch (error) {
                this.logger.warn(`Invalid notification signal: ${String(error)}`)
            }
        })
        try {
            await this.withTimeout(this.subscriber.subscribe(CHANNEL), 3_000, 'REDIS_SUBSCRIBE')
        } catch (error) {
            // Realtime is best-effort. The API and PostgreSQL notification inbox must
            // remain available even while Redis is temporarily unavailable.
            this.logger.warn(`Redis subscribe unavailable; API fallback remains active: ${String(error)}`)
        }
    }

    async publish(notificationId: string, userIds: string[]) {
        if (!userIds.length) return
        const signal: NotificationSignal = {
            notificationId,
            userIds,
            occurredAt: new Date().toISOString(),
        }
        if (!this.publisher) return
        await this.withTimeout(
            this.publisher.publish(CHANNEL, JSON.stringify(signal)),
            2_000,
            'REDIS_PUBLISH',
        )
    }

    forUser(userId: string): Observable<MessageEvent> {
        return this.signals.pipe(
            filter((signal) => signal.userIds.includes(userId)),
            map((signal) => ({
                type: 'notification',
                id: signal.notificationId,
                data: signal,
            })),
        )
    }

    async onModuleDestroy() {
        await Promise.allSettled([this.publisher?.quit(), this.subscriber?.quit()])
        this.signals.complete()
    }
}
