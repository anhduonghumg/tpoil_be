import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { CreateBankAccountDto } from './dto/create-bank-account.dto'
import { QueryBankAccountsDto } from './dto/query-bank-accounts.dto'
import { UpdateBankAccountDto } from './dto/update-bank-account.dto'

@Injectable()
export class BankAccountsService {
    constructor(private readonly prisma: PrismaService) {}

    async list(query: QueryBankAccountsDto) {
        const where: Prisma.BankAccountWhereInput = {
            ...(query.isActive === 'true' ? { isActive: true } : query.isActive === 'false' ? { isActive: false } : {}),
            ...(query.keyword
                ? {
                      OR: [
                          { bankCode: { contains: query.keyword, mode: 'insensitive' } },
                          { bankName: { contains: query.keyword, mode: 'insensitive' } },
                          { accountNo: { contains: query.keyword, mode: 'insensitive' } },
                          { accountName: { contains: query.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }

        return this.prisma.bankAccount.findMany({
            where,
            orderBy: [{ isActive: 'desc' }, { bankCode: 'asc' }, { accountNo: 'asc' }],
        })
    }

    async detail(id: string) {
        const item = await this.prisma.bankAccount.findUnique({
            where: { id },
        })

        if (!item) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        return item
    }

    async create(body: CreateBankAccountDto) {
        const bankCode = body.bankCode.trim()
        const accountNo = body.accountNo.trim()

        const existed = await this.prisma.bankAccount.findUnique({
            where: {
                bankCode_accountNo: {
                    bankCode,
                    accountNo,
                },
            },
        })

        if (existed) {
            throw new ConflictException('BANK_ACCOUNT_ALREADY_EXISTS')
        }

        return this.prisma.bankAccount.create({
            data: {
                bankCode,
                bankName: body.bankName?.trim() || null,
                accountNo,
                accountName: body.accountName?.trim() || null,
                currency: body.currency?.trim() || 'VND',
                isActive: body.isActive ?? true,
            },
        })
    }

    async update(id: string, body: UpdateBankAccountDto) {
        const existed = await this.prisma.bankAccount.findUnique({
            where: { id },
        })

        if (!existed) {
            throw new NotFoundException('BANK_ACCOUNT_NOT_FOUND')
        }

        const nextBankCode = body.bankCode?.trim() ?? existed.bankCode
        const nextAccountNo = body.accountNo?.trim() ?? existed.accountNo

        const duplicated = await this.prisma.bankAccount.findFirst({
            where: {
                id: { not: id },
                bankCode: nextBankCode,
                accountNo: nextAccountNo,
            },
        })

        if (duplicated) {
            throw new ConflictException('BANK_ACCOUNT_ALREADY_EXISTS')
        }

        return this.prisma.bankAccount.update({
            where: { id },
            data: {
                ...(body.bankCode !== undefined ? { bankCode: nextBankCode } : {}),
                ...(body.bankName !== undefined ? { bankName: body.bankName?.trim() || null } : {}),
                ...(body.accountNo !== undefined ? { accountNo: nextAccountNo } : {}),
                ...(body.accountName !== undefined ? { accountName: body.accountName?.trim() || null } : {}),
                ...(body.currency !== undefined ? { currency: body.currency?.trim() || 'VND' } : {}),
                ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
            },
        })
    }
}
