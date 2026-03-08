import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { DevDriveTestService } from './dev-drive-test.service'

@Controller('dev/drive-test')
export class DevDriveTestController {
    constructor(private readonly service: DevDriveTestService) {}

    @Post('upload')
    @UseInterceptors(FileInterceptor('file'))
    upload(@UploadedFile() file: Express.Multer.File) {
        return this.service.uploadPdf(file)
    }
}
