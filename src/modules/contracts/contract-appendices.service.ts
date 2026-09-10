import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { UpsertContractAppendixDto } from './dto/contract-appendix.dto'
import { ContractTermsService } from './contract-terms.service'

/**
 * Phụ lục hợp đồng: văn bản điều chỉnh điều khoản kể từ một ngày.
 *
 * Phụ lục không sửa đè hợp đồng gốc — nó là lớp phủ có ngày hiệu lực, và điều khoản áp
 * cho một chứng từ được ContractTermsService tính bằng cách chồng các phụ lục lên hợp
 * đồng gốc theo ngày chứng từ.
 */
@Injectable()
export class ContractAppendicesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly terms: ContractTermsService,
    ) {}

    private async getContractOrThrow(contractId: string) {
        const contract = await this.prisma.contract.findFirst({
            where: { id: contractId, deletedAt: null },
            select: { id: true, code: true, startDate: true, endDate: true },
        })
        if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng')
        return contract
    }

    private toDate(value: string) {
        const day = new Date(value)
        if (Number.isNaN(day.getTime())) throw new BadRequestException('Ngày hiệu lực không hợp lệ.')
        day.setUTCHours(0, 0, 0, 0)
        return day
    }

    /**
     * Phụ lục nằm ngoài thời hạn hợp đồng thì không điều chỉnh được gì — chặn sớm để
     * người dùng không tưởng là đã áp.
     */
    private assertWithinContract(
        contract: { code: string; startDate: Date; endDate: Date },
        effectiveDate: Date,
    ) {
        if (effectiveDate < contract.startDate || effectiveDate > contract.endDate) {
            throw new BadRequestException({
                code: 'APPENDIX_OUTSIDE_CONTRACT_PERIOD',
                message: `Ngày hiệu lực phải nằm trong thời hạn hợp đồng ${contract.code}.`,
            })
        }
    }

    async list(contractId: string) {
        await this.getContractOrThrow(contractId)
        return this.prisma.contractAppendix.findMany({
            where: { contractId },
            orderBy: { effectiveDate: 'desc' },
            include: { items: true },
        })
    }

    async create(contractId: string, dto: UpsertContractAppendixDto) {
        const contract = await this.getContractOrThrow(contractId)
        const effectiveDate = this.toDate(dto.effectiveDate)
        this.assertWithinContract(contract, effectiveDate)

        const duplicate = await this.prisma.contractAppendix.findFirst({
            where: { contractId, code: dto.code.trim() },
            select: { id: true },
        })
        if (duplicate) throw new BadRequestException(`Phụ lục ${dto.code} đã tồn tại trên hợp đồng này.`)

        return this.prisma.contractAppendix.create({
            data: {
                contractId,
                code: dto.code.trim(),
                effectiveDate,
                changeSummary: dto.changeSummary?.trim() || null,
                docUrl: dto.docUrl?.trim() || null,
                paymentTermDays: dto.paymentTermDays ?? null,
                creditLimitOverride: dto.creditLimitOverride ?? null,
                items: { create: (dto.items ?? []).map((item) => this.itemData(item)) },
            },
            include: { items: true },
        })
    }

    async update(contractId: string, appendixId: string, dto: UpsertContractAppendixDto) {
        const contract = await this.getContractOrThrow(contractId)
        const existing = await this.prisma.contractAppendix.findFirst({
            where: { id: appendixId, contractId },
            select: { id: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy phụ lục')

        const effectiveDate = this.toDate(dto.effectiveDate)
        this.assertWithinContract(contract, effectiveDate)

        const duplicate = await this.prisma.contractAppendix.findFirst({
            where: { contractId, code: dto.code.trim(), id: { not: appendixId } },
            select: { id: true },
        })
        if (duplicate) throw new BadRequestException(`Phụ lục ${dto.code} đã tồn tại trên hợp đồng này.`)

        return this.prisma.$transaction(async (tx) => {
            // Danh sách sản phẩm điều chỉnh thay thế toàn bộ, không gộp: phụ lục là một
            // văn bản trọn vẹn, bỏ một dòng ra nghĩa là dòng đó không còn được điều chỉnh.
            await tx.contractAppendixItem.deleteMany({ where: { appendixId } })
            return tx.contractAppendix.update({
                where: { id: appendixId },
                data: {
                    code: dto.code.trim(),
                    effectiveDate,
                    changeSummary: dto.changeSummary?.trim() || null,
                    docUrl: dto.docUrl?.trim() || null,
                    paymentTermDays: dto.paymentTermDays ?? null,
                    creditLimitOverride: dto.creditLimitOverride ?? null,
                    items: { create: (dto.items ?? []).map((item) => this.itemData(item)) },
                },
                include: { items: true },
            })
        })
    }

    async remove(contractId: string, appendixId: string) {
        const existing = await this.prisma.contractAppendix.findFirst({
            where: { id: appendixId, contractId },
            select: { id: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy phụ lục')
        await this.prisma.contractAppendix.delete({ where: { id: appendixId } })
        return { deleted: true }
    }

    /** Điều khoản đang áp tại một ngày — để màn hợp đồng cho xem trước khi lập chứng từ. */
    async termsAt(contractId: string, at?: string) {
        await this.getContractOrThrow(contractId)
        const day = at ? this.toDate(at) : new Date()
        const terms = await this.terms.resolveAt(contractId, day)
        if (!terms) throw new NotFoundException('Không tìm thấy hợp đồng')
        return {
            contractId: terms.contractId,
            at: terms.at,
            paymentTermDays: terms.paymentTermDays,
            creditLimitOverride: terms.creditLimitOverride?.toString() ?? null,
            appliedAppendices: terms.appliedAppendices,
            items: [...terms.items.values()].map((item) => ({
                ...item,
                price: item.price.toString(),
                minQty: item.minQty?.toString() ?? null,
                maxQty: item.maxQty?.toString() ?? null,
                discount: item.discount?.toString() ?? null,
                taxRate: item.taxRate?.toString() ?? null,
            })),
        }
    }

    private itemData(item: UpsertContractAppendixDto['items'] extends (infer T)[] | undefined ? T : never) {
        return {
            productId: item.productId,
            uom: item.uom.trim(),
            price: new Prisma.Decimal(item.price),
            minQty: item.minQty == null ? null : new Prisma.Decimal(item.minQty),
            maxQty: item.maxQty == null ? null : new Prisma.Decimal(item.maxQty),
            discount: item.discount == null ? null : new Prisma.Decimal(item.discount),
            taxRate: item.taxRate == null ? null : new Prisma.Decimal(item.taxRate),
            note: item.note?.trim() || null,
        }
    }
}
