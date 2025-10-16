// src/uploads/storage.interface.ts
export interface FileStorage {
    kind(): 'local' | 's3' | 'both'
    put(key: string, buf: Buffer, mime: string): Promise<string>
}

export const FILE_STORAGE = Symbol('FILE_STORAGE')
