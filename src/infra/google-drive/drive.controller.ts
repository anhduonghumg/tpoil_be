import { BadRequestException, Body, Controller, Get, Param, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import * as crypto from 'node:crypto'
import { GoogleDriveService } from './google-drive.service'
import type { Response } from 'express'

@Controller('drive')
export class DriveController {
    constructor(private readonly drive: GoogleDriveService) {}

    @Post('upload')
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage() }))
    async upload(@UploadedFile() file: Express.Multer.File, @Body() body: { supplierCustomerId: string; supplierName?: string }) {
        if (!file?.buffer?.length) throw new BadRequestException('file is required')
        const supplierCustomerId = body?.supplierCustomerId
        if (!supplierCustomerId) throw new BadRequestException('supplierCustomerId is required')

        const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex')

        const folderId = await this.drive.ensureSupplierFolder({
            supplierCustomerId,
            supplierName: body?.supplierName,
        })

        const uploaded = await this.drive.uploadPdf({
            parentId: folderId,
            buffer: file.buffer,
            fileName: file.originalname,
        })

        return { ...uploaded, checksum, folderId }
    }

    @Get('files/:fileId')
    async view(@Param('fileId') fileId: string, @Res() res: Response) {
        const { stream, mimeType, name } = await this.drive.downloadAsStream(fileId)
        res.setHeader('Content-Type', mimeType)
        res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`)
        stream.pipe(res)
    }
}
