// src/common/upload/upload.module.ts
import { Module, Global } from '@nestjs/common'
import { UploadController } from './uploads.controller'
import { defaultUploadConfig } from './config'
import { UploadService } from './uploads.service'
import { GoogleDriveModule } from 'src/infra/google-drive/google-drive.module'
import { DocumentStorageService } from './document-storage.service'

@Global()
@Module({
    imports: [GoogleDriveModule],
    controllers: [UploadController],
    providers: [UploadService, DocumentStorageService, { provide: 'UPLOAD_OPTIONS', useValue: defaultUploadConfig() }, { provide: UploadService, useClass: UploadService }],
    exports: [UploadService, DocumentStorageService],
})
export class UploadModule {}
