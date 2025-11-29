// src/common/upload/upload.controller.ts
import { BadRequestException, Body, Controller, Post, UploadedFile, UseInterceptors, Req } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { join } from 'path'
import type { Request } from 'express'
import { FileValidationPipe } from './file-validation.pipe'
import { defaultUploadConfig } from './config'
import { UploadService } from './uploads.service'
import { success } from 'src/common/http/http.response.util'

const cfg = defaultUploadConfig()

@Controller('uploads')
export class UploadController {
    constructor(private readonly service: UploadService) {}

    @Post('image')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    // tạm ghi vào /uploads/tmp, sau đó service sẽ move đúng folder
                    const dest = join(cfg.local.root, 'tmp')
                    cb(null, dest)
                },
                filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
            }),
            limits: { fileSize: cfg.limits?.fileSize },
        }),
    )
    async uploadImage(
        @Req() req: Request,
        @UploadedFile(new FileValidationPipe(cfg.accept, cfg.limits?.fileSize))
        file: Express.Multer.File,
        @Body('folder') folder?: string,
    ) {
        if (!file) throw new BadRequestException('Không có file')
        const rs = await this.service.saveLocal(file, folder || 'employee')
        const requestId = (req.headers['x-request-id'] as string) || (req as any).requestId
        return success({ url: rs.url }, 'Uploaded', 200, requestId)
    }

    @Post('file')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    // tạm ghi vào /uploads/tmp, sau đó service sẽ move đúng folder
                    const dest = join(cfg.local.root, 'tmp')
                    cb(null, dest)
                },
                filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
            }),
            limits: { fileSize: cfg.limitfileSize?.fileSize },
        }),
    )
    async uploadFile(
        @Req() req: Request,
        @UploadedFile(new FileValidationPipe(cfg.acceptFileTypes, cfg.limitfileSize?.fileSize))
        file: Express.Multer.File,
        @Body('folder') folder?: string,
    ) {
        if (!file) throw new BadRequestException('Không có file')
        const rs = await this.service.saveLocal(file, folder || 'contract')
        const requestId = (req.headers['x-request-id'] as string) || (req as any).requestId
        return success({ url: rs.url }, 'Uploaded', 200, requestId)
    }

    @Post('delete')
    async deleteFiles(@Req() req: Request, @Body('urls') urls: string[]) {
        if (!Array.isArray(urls) || urls.length === 0) {
            throw new BadRequestException({
                code: 'BAD_REQUEST',
                message: 'urls must be a non-empty array',
            })
        }
        const { deleted, failed } = await this.service.deleteByUrls(urls)
        const requestId = (req.headers['x-request-id'] as string) || (req as any)?.requestId
        return success({ deleted, failed }, 'Deleted', 200, requestId)
    }
}
