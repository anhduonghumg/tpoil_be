// src/common/upload/types.ts
export type StorageDriver = 'local'

export interface UploadModuleOptions {
    driver: StorageDriver
    local: {
        root: string
        baseUrl: string
    }
    limits?: {
        fileSize?: number
    }
    limitfileSize?: {
        fileSize?: number
    }
    accept?: string[]
    acceptFileTypes?: string[]
}
