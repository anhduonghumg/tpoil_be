// Phải đứng đầu: cố định múi giờ Việt Nam trước khi bất kỳ module nào tạo Date.
import './common/timezone'
import { NestFactory } from '@nestjs/core'
import { SchedulerModule } from './scheduler-app.module'
import { Logger } from '@nestjs/common'
import 'dotenv/config'

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(SchedulerModule, { logger: ['log', 'error', 'warn'] })
    app.enableShutdownHooks()
    new Logger('Scheduler').log('Scheduler READY')
    console.log('[BOOT][SCHEDULER] REDIS_URL=', process.env.REDIS_URL)
}
bootstrap()
