import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { CreateBankImportTemplateDto } from './dto/create-bank-import-template.dto'
import { QueryBankImportTemplatesDto } from './dto/query-bank-import-templates.dto'
import { UpdateBankImportTemplateDto } from './dto/update-bank-import-template.dto'

@Injectable()
export class BankImportTemplatesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: QueryBankImportTemplatesDto) {
        const where: Prisma.BankImportTemplateWhereInput = {
            ...(query.bankCode ? { bankCode: query.bankCode } : {}),
            ...(query.isActive === 'true' ? { isActive: true } : query.isActive === 'false' ? { isActive: false } : {}),
            ...(query.keyword
                ? {
                      OR: [{ bankCode: { contains: query.keyword, mode: 'insensitive' } }, { name: { contains: query.keyword, mode: 'insensitive' } }],
                  }
                : {}),
        }

        return this.prisma.bankImportTemplate.findMany({
            where,
            orderBy: [{ isActive: 'desc' }, { bankCode: 'asc' }, { name: 'asc' }, { version: 'desc' }],
        })
    }

    async detail(id: string) {
        const item = await this.prisma.bankImportTemplate.findUnique({
            where: { id },
        })

        if (!item) {
            throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
        }

        return item
    }

    async create(body: CreateBankImportTemplateDto) {
        const bankCode = body.bankCode.trim()
        const name = body.name.trim()
        const version = body.version ?? 1

        const existed = await this.prisma.bankImportTemplate.findUnique({
            where: {
                bankCode_name_version: {
                    bankCode,
                    name,
                    version,
                },
            },
        })

        if (existed) {
            throw new ConflictException('BANK_IMPORT_TEMPLATE_ALREADY_EXISTS')
        }

        return this.prisma.bankImportTemplate.create({
            data: {
                bankCode,
                name,
                version,
                columnMap: body.columnMap,
                normalizeRule: body.normalizeRule ?? '',
                isActive: body.isActive ?? true,
            },
        })
    }

    async update(id: string, body: UpdateBankImportTemplateDto) {
        const existed = await this.prisma.bankImportTemplate.findUnique({
            where: { id },
        })

        if (!existed) {
            throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
        }

        const nextBankCode = body.bankCode?.trim() ?? existed.bankCode
        const nextName = body.name?.trim() ?? existed.name
        const nextVersion = body.version ?? existed.version

        const duplicated = await this.prisma.bankImportTemplate.findFirst({
            where: {
                id: { not: id },
                bankCode: nextBankCode,
                name: nextName,
                version: nextVersion,
            },
        })

        if (duplicated) {
            throw new ConflictException('BANK_IMPORT_TEMPLATE_ALREADY_EXISTS')
        }

        return this.prisma.bankImportTemplate.update({
            where: { id },
            data: {
                ...(body.bankCode !== undefined ? { bankCode: nextBankCode } : {}),
                ...(body.name !== undefined ? { name: nextName } : {}),
                ...(body.version !== undefined ? { version: nextVersion } : {}),
                ...(body.columnMap !== undefined ? { columnMap: body.columnMap } : {}),
                ...(body.normalizeRule !== undefined ? { normalizeRule: body.normalizeRule ?? null } : {}),
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            },
        })
    }

    async listActive(bankCode?: string) {
        return this.prisma.bankImportTemplate.findMany({
            where: {
                isActive: true,
                ...(bankCode ? { bankCode } : {}),
            },
            orderBy: [{ bankCode: 'asc' }, { name: 'asc' }, { version: 'desc' }],
        })
    }

    async getActiveById(id: string) {
        const item = await this.prisma.bankImportTemplate.findFirst({
            where: {
                id,
                isActive: true,
            },
        })

        if (!item) {
            throw new NotFoundException('BANK_IMPORT_TEMPLATE_NOT_FOUND')
        }

        return item
    }
}
