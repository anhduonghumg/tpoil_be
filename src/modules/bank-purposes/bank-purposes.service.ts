import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateBankPurposeDto } from './dto/create-bank-purpose.dto'
import { BankPurposeQueryDto } from './dto/bank-purpose-query.dto'
import { UpdateBankPurposeDto } from './dto/update-bank-purpose.dto'

@Injectable()
export class BankPurposesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: BankPurposeQueryDto) {
        const page = query.page ?? 1
        const pageSize = query.pageSize ?? 20
        const skip = (page - 1) * pageSize
        const keyword = query.keyword?.trim()

        const where: Prisma.BankTransactionPurposeWhereInput = keyword
            ? {
                  OR: [
                      { code: { contains: keyword, mode: 'insensitive' } },
                      { name: { contains: keyword, mode: 'insensitive' } },
                      { description: { contains: keyword, mode: 'insensitive' } },
                      { module: { contains: keyword, mode: 'insensitive' } },
                  ],
              }
            : {}

        const [items, total] = await this.prisma.$transaction([
            this.prisma.bankTransactionPurpose.findMany({
                where,
                orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
                skip,
                take: pageSize,
            }),
            this.prisma.bankTransactionPurpose.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
            totalPages: Math.ceil(total / pageSize),
        }
    }

    async all() {
        return this.prisma.bankTransactionPurpose.findMany({
            where: { isActive: true },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        })
    }

    async detail(id: string) {
        const item = await this.prisma.bankTransactionPurpose.findUnique({
            where: { id },
        })

        if (!item) {
            throw new NotFoundException('Không tìm thấy mục đích giao dịch')
        }

        return item
    }

    async create(dto: CreateBankPurposeDto) {
        const code = dto.code.trim().toUpperCase()
        const name = dto.name.trim()

        const existed = await this.prisma.bankTransactionPurpose.findUnique({
            where: { code },
            select: { id: true },
        })

        if (existed) {
            throw new ConflictException('Mã mục đích giao dịch đã tồn tại')
        }

        return this.prisma.bankTransactionPurpose.create({
            data: {
                code,
                name,
                description: dto.description?.trim() || null,
                direction: dto.direction ?? null,
                module: dto.module?.trim() || null,
                counterpartyType: dto.counterpartyType ?? null,
                affectsDebt: dto.affectsDebt ?? false,
                isSystem: dto.isSystem ?? false,
                isActive: dto.isActive ?? true,
                sortOrder: dto.sortOrder ?? 0,
            },
        })
    }

    async update(id: string, dto: UpdateBankPurposeDto) {
        const current = await this.detail(id)

        if (current.isSystem && dto.code && dto.code.trim().toUpperCase() !== current.code) {
            throw new ConflictException('Không được đổi mã của mục đích hệ thống')
        }

        if (dto.code) {
            const existed = await this.prisma.bankTransactionPurpose.findFirst({
                where: {
                    code: dto.code.trim().toUpperCase(),
                    NOT: { id },
                },
                select: { id: true },
            })

            if (existed) {
                throw new ConflictException('Mã mục đích giao dịch đã tồn tại')
            }
        }

        return this.prisma.bankTransactionPurpose.update({
            where: { id },
            data: {
                code: dto.code?.trim().toUpperCase(),
                name: dto.name?.trim(),
                description: dto.description?.trim(),
                direction: dto.direction,
                module: dto.module?.trim(),
                counterpartyType: dto.counterpartyType,
                affectsDebt: dto.affectsDebt,
                isSystem: dto.isSystem,
                isActive: dto.isActive,
                sortOrder: dto.sortOrder,
            },
        })
    }

    async remove(id: string) {
        const current = await this.detail(id)

        if (current.isSystem) {
            throw new ConflictException('Không được xóa mục đích hệ thống')
        }

        const used = await this.prisma.bankTransaction.count({
            where: { purposeId: id },
        })

        if (used > 0) {
            throw new ConflictException('Mục đích giao dịch đã được sử dụng, không thể xóa')
        }

        await this.prisma.bankTransactionPurpose.delete({
            where: { id },
        })

        return { success: true }
    }
}
