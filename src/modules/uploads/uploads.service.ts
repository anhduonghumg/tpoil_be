// src/common/upload/upload.service.ts
import { Inject, Injectable } from '@nestjs/common'
import * as fs from 'fs'
import { basename, join, extname, resolve } from 'path'
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

    private safeFolder(folder?: string) {
        if (!folder) return undefined

        const parts = folder
            .replace(/\\/g, '/')
            .split('/')
            .map((part) => part.trim())
            .filter(Boolean)
            .map((part) => part.replace(/[^a-zA-Z0-9_-]/g, ''))
            .filter(Boolean)

        return parts.length ? parts.join('/') : undefined
    }

    private checksum(buffer: Buffer) {
        return crypto.createHash('sha256').update(buffer).digest('hex')
    }

    saveLocal(file: Express.Multer.File, folder?: string) {
        const { root, baseUrl } = this.opts.local
        const safeFolder = this.safeFolder(folder)
        const targetDir = safeFolder ? join(root, safeFolder) : root
        this.ensureDir(targetDir)

        const filename = this.randomName(file.originalname)
        const destPath = join(targetDir, filename)
        const sourceBuffer = file.buffer || (file.path && fs.existsSync(file.path) ? fs.readFileSync(file.path) : undefined)

        // nếu multer đã viết vào temp path (memoryStorage) → tự ghi
        if (file.buffer) {
            fs.writeFileSync(destPath, file.buffer)
        } else if (file.path && fs.existsSync(file.path)) {
            fs.renameSync(file.path, destPath)
        } else {
            // fallback
            fs.writeFileSync(destPath, file.buffer)
        }

        const relative = safeFolder ? `/${safeFolder}/${filename}` : `/${filename}`
        const url = `${baseUrl}${relative}`

        return {
            url,
            path: destPath,
            fileName: filename,
            originalName: basename(file.originalname),
            mimeType: file.mimetype,
            sizeBytes: file.size,
            checksum: sourceBuffer ? this.checksum(sourceBuffer) : null,
        }
    }

    private toAbsFromUrl(url?: string | null): string | null {
        if (!url || typeof url !== 'string') return null

        // Chuẩn hoá baseUrl: '/static'
        const baseUrl = (this.opts.local.baseUrl || '/static').replace(/\/+$/, '')

        const idx = url.indexOf(baseUrl + '/')
        if (idx === -1) return null

        const rel = url.slice(idx + baseUrl.length)

        // Ghép vào uploads root
        const root = resolve(this.opts.local.root)
        const abs = resolve(join(root, '.' + rel))

        if (!abs.startsWith(root)) return null

        return abs
    }

    async deleteByUrls(urls: string[]): Promise<{ deleted: number; failed: string[] }> {
        const uniq = Array.from(new Set((urls || []).filter((u) => typeof u === 'string' && u.length)))
        let deleted = 0
        const failed: string[] = []

        await Promise.all(
            uniq.map(async (u) => {
                const abs = this.toAbsFromUrl(u)
                if (!abs) {
                    failed.push(u)
                    return
                }
                try {
                    // console.log('log:', abs)
                    await fs.promises.unlink(abs)
                    deleted++
                } catch (err: any) {
                    if (err?.code !== 'ENOENT') failed.push(u)
                }
            }),
        )

        return { deleted, failed }
    }
}
