// src/common/upload/decorators.ts
import { applyDecorators, UseInterceptors } from '@nestjs/common'
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express'
import { diskStorage, memoryStorage } from 'multer'
import { join } from 'path'
import { defaultUploadConfig } from './config'

const cfg = defaultUploadConfig()

export function UploadImage(fieldName = 'file') {
    return applyDecorators(
        UseInterceptors(
            FileInterceptor(fieldName, {
                storage: diskStorage({
                    destination: (_req, _file, cb) => cb(null, join(cfg.local.root, 'tmp')),
                    filename: (_req, file, cb) => cb(null, Date.now() + '-' + file.originalname),
                }),
                limits: { fileSize: cfg.limits?.fileSize },
            }),
        ),
    )
}

export function UploadAny(fieldName = 'files', maxCount = 10) {
    return applyDecorators(
        UseInterceptors(
            FilesInterceptor(fieldName, maxCount, {
                storage: memoryStorage(),
                limits: { fileSize: cfg.limits?.fileSize },
            }),
        ),
    )
}
