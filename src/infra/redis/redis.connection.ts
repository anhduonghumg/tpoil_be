// src/infra/redis/redis.connection.ts
import { Logger } from '@nestjs/common'
import IORedis from 'ioredis'

const logger = new Logger('Redis')

/**
 * Mỗi tiến trình mở nhiều kết nối Redis (một cho Queue, một cho từng Worker, hai cho
 * event bus thông báo). Trước đây mỗi kết nối in cả 'connect' lẫn 'ready' nên terminal
 * đầy những dòng giống hệt nhau. Giờ mỗi kết nối chỉ in một dòng và có nhãn để biết
 * kết nối nào đang nói.
 */
export function createRedisConnection(label = 'shared') {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not defined')

    const isTls = url.startsWith('rediss://')

    const redis = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        ...(isTls ? { tls: {} } : {}),
    })

    let announced = false

    redis.on('ready', () => {
        if (announced) {
            // Kết nối lại sau khi rớt mạng — đáng biết, nhưng không phải log khởi động.
            logger.log(`[${label}] đã kết nối lại`)
            return
        }
        announced = true
        logger.log(`[${label}] sẵn sàng`)
    })

    redis.on('error', (err) => {
        logger.error(`[${label}] lỗi kết nối - ${err.message}`)
    })

    redis.on('close', () => {
        logger.warn(`[${label}] kết nối đã đóng`)
    })

    return redis
}
