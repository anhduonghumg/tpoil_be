// src/common/upload/upload.config.ts
import { join } from 'path'
import { UploadModuleOptions } from './types'

export const defaultUploadConfig = (): UploadModuleOptions => ({
    driver: 'local',
    local: {
        root: join(process.cwd(), 'uploads'),
        baseUrl: '/static',
    },
    limits: { fileSize: 5 * 1024 * 1024 },
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
})
