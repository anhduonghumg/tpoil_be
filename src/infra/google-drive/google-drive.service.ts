import { BadRequestException, Inject, Injectable } from '@nestjs/common'
import { drive_v3 } from 'googleapis'
import { Readable } from 'node:stream'
import type { GoogleDriveOptions } from './gdrive.env'
import { GD_CLIENT, GD_OPTIONS } from './google-drive.tokens'

@Injectable()
export class GoogleDriveService {
    constructor(
        @Inject(GD_OPTIONS) private readonly opts: GoogleDriveOptions,
        @Inject(GD_CLIENT) private readonly drive: drive_v3.Drive,
    ) {}

    getRootFolderId() {
        return this.opts.rootFolderId
    }

    private safeName(name: string) {
        return (name || 'upload.pdf')
            .trim()
            .replace(/[\\/:*?"<>|]/g, '_')
            .replace(/\s+/g, ' ')
            .slice(0, 120)
    }

    private escapeQ(value: string) {
        return value.replace(/'/g, "\\'")
    }

    async ensureFolder(args: { name: string; parentId?: string }) {
        const parentId = args.parentId ?? this.opts.rootFolderId
        if (!parentId) throw new BadRequestException('parentId is required')

        const folderName = this.safeName(args.name)

        const q = [`'${parentId}' in parents`, `name='${this.escapeQ(folderName)}'`, `mimeType='application/vnd.google-apps.folder'`, `trashed=false`].join(' and ')

        const existed = await this.drive.files.list({
            q,
            pageSize: 1,
            fields: 'files(id,name)',
            supportsAllDrives: true,
            includeItemsFromAllDrives: true,
        })

        const f = existed.data.files?.[0]
        if (f?.id) return f.id

        const created = await this.drive.files.create({
            requestBody: {
                name: folderName,
                mimeType: 'application/vnd.google-apps.folder',
                parents: [parentId],
            },
            fields: 'id',
            supportsAllDrives: true,
        })

        if (!created.data.id) throw new Error('Failed to create folder')
        return created.data.id
    }

    async ensureSupplierFolder(args: { supplierCustomerId: string; supplierName?: string; parentId?: string }) {
        if (!args.supplierCustomerId) throw new BadRequestException('supplierCustomerId is required')

        const suffix = args.supplierName ? `_${args.supplierName}` : ''
        const base = `SUP_${args.supplierCustomerId}${suffix}`

        return this.ensureFolder({ name: base, parentId: args.parentId })
    }

    async uploadPdf(args: { parentId?: string; buffer: Buffer; fileName: string }) {
        const parentId = args.parentId ?? this.opts.rootFolderId
        if (!parentId) throw new BadRequestException('parentId is required')

        const fileName = this.safeName(args.fileName)

        const created = await this.drive.files.create({
            requestBody: {
                name: fileName,
                parents: [parentId],
                mimeType: 'application/pdf',
            },
            media: {
                mimeType: 'application/pdf',
                body: Readable.from(args.buffer),
            },
            fields: 'id,name,mimeType,webViewLink,webContentLink,size,md5Checksum',
            supportsAllDrives: true,
        })

        if (!created.data.id) throw new Error('Upload failed (missing fileId)')

        return {
            fileId: created.data.id,
            fileName: created.data.name ?? fileName,
            mimeType: created.data.mimeType ?? 'application/pdf',
            size: created.data.size ? Number(created.data.size) : null,
            md5: created.data.md5Checksum ?? null,
            webViewLink: created.data.webViewLink ?? null,
            webContentLink: created.data.webContentLink ?? null,
        }
    }

    async downloadAsStream(fileId: string) {
        if (!fileId) throw new BadRequestException('fileId is required')

        const meta = await this.drive.files.get({
            fileId,
            fields: 'id,name,mimeType',
            supportsAllDrives: true,
        })

        const media = await this.drive.files.get({ fileId, alt: 'media', supportsAllDrives: true }, { responseType: 'stream' })

        return {
            name: meta.data.name ?? fileId,
            mimeType: meta.data.mimeType ?? 'application/octet-stream',
            stream: media.data as unknown as NodeJS.ReadableStream,
        }
    }
}
