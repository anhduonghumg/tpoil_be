import { Injectable } from '@nestjs/common'
import { BankImportProcessor } from './bank-import.processor'
import { BANK_IMPORT_MODE, BANK_IMPORT_SYNC_MAX_ROWS } from '../../../config/banking.config'
import ExcelJS from 'exceljs'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class BankImportsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly processor: BankImportProcessor,
    ) {}

    async createAndMaybeProcess(dto: { bankAccountId: string; templateId?: string; fileUrl: string; fileChecksum?: string }) {
        const imp = await this.prisma.bankStatementImport.create({
            data: {
                bankAccountId: dto.bankAccountId,
                templateId: dto.templateId ?? null,
                fileUrl: dto.fileUrl,
                fileChecksum: dto.fileChecksum ?? null,
                status: 'QUEUED',
            },
        })

        const rowCount = await this.estimateRowCount(dto.fileUrl)
        const shouldSync = BANK_IMPORT_MODE === 'sync' || rowCount <= BANK_IMPORT_SYNC_MAX_ROWS

        if (shouldSync) {
            return this.processor.processImport(imp.id)
        }

        return { importId: imp.id, status: 'QUEUED', rowCount, mode: 'queue_later' }
    }

    async processSync(importId: string) {
        return this.processor.processImport(importId)
    }

    async detail(importId: string) {
        return this.prisma.bankStatementImport.findUnique({
            where: { id: importId },
            include: { bankAccount: true, template: true },
        })
    }

    private async estimateRowCount(filePath: string) {
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.readFile(filePath)
        const ws = wb.worksheets[0]
        if (!ws) return 0
        return Math.max(0, ws.rowCount - 1)
    }
}
