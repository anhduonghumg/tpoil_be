// src/worker.ts
import { NestFactory } from '@nestjs/core'
import { WorkerModule } from './worker-app.module'
import { Logger } from '@nestjs/common'
import 'dotenv/config'

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(WorkerModule, {
        logger: ['log', 'error', 'warn'],
    })

    const logger = new Logger('WorkerSystem')
    app.enableShutdownHooks()

    logger.log('--- WORKER READY ---')
    console.log('[BOOT][WORKER] REDIS_URL=', process.env.REDIS_URL)
}

bootstrap().catch((e) => {
    console.error('[BOOT] WORKER CRASH', e)
    process.exit(1)
})
