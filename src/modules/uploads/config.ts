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
    limitfileSize: { fileSize: 20 * 1024 * 1024 },
    accept: ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'],
    acceptFileTypes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv',
        'application/csv',
        'image/png',
        'image/jpeg',
        'image/jpg',
        'image/webp',
    ],
})
