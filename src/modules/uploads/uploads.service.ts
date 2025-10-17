// src/common/upload/upload.service.ts
import { Inject, Injectable } from '@nestjs/common'
import * as fs from 'fs'
import { join, extname } from 'path'
import * as crypto from 'crypto'
import type { UploadModuleOptions } from './types'
import { UPLOAD_OPTIONS } from './tokens'

@Injectable()
export class UploadService {
    constructor(@Inject(UPLOAD_OPTIONS) private readonly opts: UploadModuleOptions) {}

    private ensureDir(dir: string) {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    }

    // tên file ngẫu nhiên
    private randomName(original: string) {
        const ext = extname(original)?.toLowerCase() || ''
        return `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${ext || '.bin'}`
    }

    saveLocal(file: Express.Multer.File, folder?: string) {
        const { root, baseUrl } = this.opts.local
        const targetDir = folder ? join(root, folder) : root
        this.ensureDir(targetDir)

        const filename = this.randomName(file.originalname)
        const destPath = join(targetDir, filename)

        // nếu multer đã viết vào temp path (memoryStorage) → tự ghi
        if (file.buffer) {
            fs.writeFileSync(destPath, file.buffer)
        } else if (file.path && fs.existsSync(file.path)) {
            fs.renameSync(file.path, destPath)
        } else {
            // fallback
            fs.writeFileSync(destPath, file.buffer)
        }

        const relative = folder ? `/${folder}/${filename}` : `/${filename}`
        const url = `${baseUrl}${relative}`

        return { url, path: destPath }
    }
}
