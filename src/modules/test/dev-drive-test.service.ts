import { BadRequestException, Injectable } from '@nestjs/common'
import { google } from 'googleapis'
import { Readable } from 'stream'
import * as crypto from 'crypto'

function sha256(buf: Buffer) {
    return crypto.createHash('sha256').update(buf).digest('hex')
}

@Injectable()
export class DevDriveTestService {
    async uploadPdf(file: Express.Multer.File) {
        if (!file?.buffer?.length) throw new BadRequestException('Missing file (multipart field "file")')

        const rootId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID
        if (!rootId) throw new Error('Missing GOOGLE_DRIVE_ROOT_FOLDER_ID')

        const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
        if (!jsonStr) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_JSON')

        const creds = JSON.parse(jsonStr)

        const auth = new google.auth.JWT({
            email: creds.client_email,
            key: creds.private_key,
            scopes: ['https://www.googleapis.com/auth/drive'],
        })

        await auth.authorize()
        const drive = google.drive({ version: 'v3', auth })

        const checksumSha256 = sha256(file.buffer)
        const fileName = file.originalname || `test-${Date.now()}.pdf`

        const res = await drive.files.create({
            requestBody: { name: fileName, parents: [rootId] },
            media: { mimeType: 'application/pdf', body: Readable.from(file.buffer) },
            fields: 'id,name,size,md5Checksum,mimeType',
            supportsAllDrives: true,
        })

        return {
            ok: true,
            fileId: res.data.id,
            name: res.data.name,
            size: res.data.size ? Number(res.data.size) : null,
            md5: res.data.md5Checksum ?? null,
            sha256: checksumSha256,
        }
    }
}
