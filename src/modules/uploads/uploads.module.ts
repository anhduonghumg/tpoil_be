// src/common/upload/upload.module.ts
import { Module, Global } from '@nestjs/common'
import { UploadController } from './uploads.controller'
import { defaultUploadConfig } from './config'
import { UploadService } from './uploads.service'

@Global()
@Module({
    controllers: [UploadController],
    providers: [UploadService, { provide: 'UPLOAD_OPTIONS', useValue: defaultUploadConfig() }, { provide: UploadService, useClass: UploadService }],
    exports: [UploadService],
})
export class UploadModule {}
