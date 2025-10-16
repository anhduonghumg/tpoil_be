import { BadRequestException, Body, Controller, Post, Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { diskStorage } from 'multer'
import { extname, join } from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import type { Request } from 'express'
import { success } from 'src/common/http/http.response.util'

const ACCEPT = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp']

const ensureDir = (p: string) => {
    if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

const randName = (original: string) => `${Date.now()}_${crypto.randomBytes(8).toString('hex')}${extname(original)?.toLowerCase() || '.jpg'}`

@Controller('uploads')
export class UploadsController {
    @Post('image')
    @UseInterceptors(
        FileInterceptor('file', {
            storage: diskStorage({
                destination: (_req, _file, cb) => {
                    const base = join(process.cwd(), 'uploads', 'employee')
                    ensureDir(base)
                    cb(null, base)
                },
                filename: (_req, file, cb) => cb(null, randName(file.originalname)),
            }),
            limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
            fileFilter: (_req, file, cb) => (ACCEPT.includes(file.mimetype) ? cb(null, true) : cb(new BadRequestException('Định dạng không hỗ trợ'), false)),
        }),
    )
    uploadImage(@Req() req: Request, @UploadedFile() file: Express.Multer.File, @Body('folder') folder?: string) {
        if (!file) throw new BadRequestException('Không có file')

        // Nếu FE truyền folder (vd: employee/avatar | employee/citizen) → move sang folder đó
        let publicUrl = `/static/employee/${file.filename}`
        if (folder && folder.trim()) {
            const destDir = join(process.cwd(), 'uploads', folder.trim())
            ensureDir(destDir)
            fs.renameSync(file.path, join(destDir, file.filename))
            publicUrl = `/static/${folder.trim()}/${file.filename}`
        }

        const requestId = (req.headers['x-request-id'] as string) || (req as any).requestId
        return success({ url: publicUrl }, 'Uploaded', 200, requestId)
    }
}
