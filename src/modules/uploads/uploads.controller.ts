import { BadRequestException, Body, Controller, Get, Param, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage, memoryStorage } from 'multer'
import { join } from 'path'
import * as fs from 'fs'
import type { Request, Response } from 'express'
import { FileValidationPipe } from './file-validation.pipe'
import { defaultUploadConfig } from './config'
import { UploadService } from './uploads.service'
import { DocumentStorageService } from './document-storage.service'
import { success } from 'src/common/http/http.response.util'

const cfg = defaultUploadConfig()

@Controller('uploads')
export class UploadController {
    constructor(
        private readonly service: UploadService,
        private readonly documentStorage: DocumentStorageService,
    ) {}

    @Post('image')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    const dest = join(cfg.local.root, 'tmp')
                    fs.mkdirSync(dest, { recursive: true })
                    cb(null, dest)
                },
                filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
            }),
            limits: { fileSize: cfg.limits?.fileSize },
        }),
    )
    async uploadImage(
        @Req() req: Request,
        @UploadedFile(new FileValidationPipe(cfg.accept, cfg.limits?.fileSize)) file: Express.Multer.File,
        @Body('folder') folder?: string,
    ) {
        const result = await this.service.saveLocal(file, folder || 'employee')
        const requestId = (req.headers['x-request-id'] as string) || (req as any).requestId
        return success(result, 'Uploaded', 200, requestId)
    }

    // Common document endpoint. Files are persisted in Google Drive, not on the backend disk.
    @Post('file')
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: cfg.limitfileSize?.fileSize } }))
    async uploadFile(
        @Req() req: Request,
        @UploadedFile(new FileValidationPipe(cfg.acceptFileTypes, cfg.limitfileSize?.fileSize)) file: Express.Multer.File,
        @Body('folder') folder?: string,
    ) {
        if (!file?.buffer?.length) throw new BadRequestException('Không có file')
        const result = await this.documentStorage.upload(file, folder || 'documents')
        const requestId = (req.headers['x-request-id'] as string) || (req as any).requestId
        return success(result, 'Uploaded', 200, requestId)
    }

    @Get('files/:fileId')
    async viewFile(@Param('fileId') fileId: string, @Res() res: Response) {
        const { stream, mimeType, name } = await this.documentStorage.download(fileId)
        res.setHeader('Content-Type', mimeType)
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`)
        stream.pipe(res)
    }

    @Post('delete')
    async deleteFiles(@Req() req: Request, @Body('urls') urls: string[]) {
        if (!Array.isArray(urls) || urls.length === 0) {
            throw new BadRequestException({ code: 'BAD_REQUEST', message: 'urls must be a non-empty array' })
        }

        const driveUrls = urls.filter((url) => this.documentStorage.fileIdFromUrl(url))
        const localUrls = urls.filter((url) => !this.documentStorage.fileIdFromUrl(url))
        const [driveResult, localResult] = await Promise.all([
            this.documentStorage.deleteByUrls(driveUrls),
            this.service.deleteByUrls(localUrls),
        ])
        const requestId = (req.headers['x-request-id'] as string) || (req as any)?.requestId
        return success(
            { deleted: driveResult.deleted + localResult.deleted, failed: [...driveResult.failed, ...localResult.failed] },
            'Deleted',
            200,
            requestId,
        )
    }
}
