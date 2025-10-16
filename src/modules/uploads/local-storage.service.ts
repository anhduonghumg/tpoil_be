// src/uploads/local-storage.service.ts
import { FileStorage } from './storage.interface'
import * as fs from 'fs'
import { dirname, join } from 'path'

export class LocalStorageService implements FileStorage {
    private root = process.env.LOCAL_ROOT ?? 'uploads'
    private publicBase = process.env.LOCAL_PUBLIC_BASE ?? '/static'

    kind(): 'local' {
        return 'local'
    }

    async put(key: string, buf: Buffer, _mime: string): Promise<string> {
        const full = join(this.root, key)
        const dir = dirname(full)
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
        await fs.promises.writeFile(full, buf)

        return `${this.publicBase}/${key}`.replace(/\\/g, '/')
    }
}
