// src/infra/redis/redis.connection.ts
import IORedis from 'ioredis'

export function createRedisConnection() {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not defined')

    const isTls = url.startsWith('rediss://')

    const redis = new IORedis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        ...(isTls ? { tls: {} } : {}),
    })

    redis.on('connect', () => {
        console.log('Redis: Đã kết nối thành công (Connected)')
    })

    redis.on('ready', () => {
        console.log('Redis: Đã sẵn sàng xử lý hàng đợi (Ready)')
    })

    redis.on('error', (err) => {
        console.error('Redis: Lỗi kết nối -', err.message)
    })

    redis.on('close', () => {
        console.warn('Redis: Kết nối đã bị đóng')
    })

    return redis
}
