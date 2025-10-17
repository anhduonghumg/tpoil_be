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
    accept?: string[]
}
