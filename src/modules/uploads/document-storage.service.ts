import { Injectable } from '@nestjs/common'
import { GoogleDriveService } from 'src/infra/google-drive/google-drive.service'

@Injectable()
export class DocumentStorageService {
    constructor(private readonly drive: GoogleDriveService) {}

    async upload(file: Express.Multer.File, folder?: string) {
        const parentId = await this.resolveParentFolder(folder)
        const uploaded = await this.drive.uploadFile({
            parentId,
            buffer: file.buffer,
            fileName: file.originalname,
            mimeType: file.mimetype,
        })

        return {
            provider: 'google-drive' as const,
            fileId: uploaded.fileId,
            fileName: uploaded.fileName,
            originalName: file.originalname,
            mimeType: uploaded.mimeType,
            sizeBytes: uploaded.size ?? file.size,
            checksum: uploaded.md5,
            url: `/api/uploads/files/${uploaded.fileId}`,
        }
    }

    private async resolveParentFolder(folder?: string) {
        const normalized = (folder || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
        const warehousePrefix = 'warehouse-rental-contracts'
        if (normalized === warehousePrefix || normalized.startsWith(`${warehousePrefix}/`)) {
            const rootFolderId = this.drive.getWarehouseRentalContractsFolderId() ?? (await this.drive.ensureFolderPath('HOP DONG THUE KHO'))
            const warehouseFolder = normalized.slice(warehousePrefix.length).replace(/^\/+/, '')
            return warehouseFolder ? this.drive.ensureFolderPath(warehouseFolder, rootFolderId) : rootFolderId
        }
        return this.drive.ensureFolderPath(normalized || undefined)
    }

    async download(fileId: string) {
        return this.drive.downloadAsStream(fileId)
    }

    fileIdFromUrl(url?: string | null) {
        if (!url) return null
        try {
            const pathname = new URL(url, 'http://local').pathname
            const matched = pathname.match(/^\/api\/uploads\/files\/([^/]+)$/)
            return matched?.[1] ? decodeURIComponent(matched[1]) : null
        } catch {
            return null
        }
    }

    async deleteByUrls(urls: string[]) {
        const fileIds = Array.from(new Set(urls.map((url) => this.fileIdFromUrl(url)).filter((id): id is string => Boolean(id))))
        const failed: string[] = []
        let deleted = 0

        await Promise.all(
            fileIds.map(async (fileId) => {
                try {
                    await this.drive.deleteFile(fileId)
                    deleted++
                } catch {
                    failed.push(fileId)
                }
            }),
        )
        return { deleted, failed }
    }
}
