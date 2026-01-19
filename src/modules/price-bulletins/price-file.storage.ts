// src/modules/price-bulletins/price-file.storage.ts
import { Injectable } from '@nestjs/common'
import { createHash } from 'crypto'
import * as fs from 'fs/promises'
import * as path from 'path'

@Injectable()
export class PricePdfStorage {
    private readonly dir = process.env.PRICE_PDF_DIR || path.join(process.cwd(), 'storage', 'price-pdfs')

    async savePdfBuffer(args: { buffer: Buffer; originalName: string }) {
        await fs.mkdir(this.dir, { recursive: true })

        const checksum = createHash('sha256').update(args.buffer).digest('hex')
        const safeName = args.originalName.replace(/[^\w.\-]+/g, '_')
        const fileName = `${Date.now()}_${checksum.slice(0, 12)}_${safeName}`
        const absPath = path.join(this.dir, fileName)

        await fs.writeFile(absPath, args.buffer)

        return { filePath: absPath, fileName, checksum }
    }
}
