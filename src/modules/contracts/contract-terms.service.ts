import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

/** Điều khoản của một sản phẩm tại một thời điểm. */
export type ResolvedContractItem = {
    productId: string
    uom: string
    /** Giá sàn: đơn bán thấp hơn mức này phải qua duyệt ngoại lệ. */
    price: Prisma.Decimal
    minQty: Prisma.Decimal | null
    maxQty: Prisma.Decimal | null
    discount: Prisma.Decimal | null
    taxRate: Prisma.Decimal | null
    note: string | null
    /** Phụ lục đã đặt ra mức này; null = vẫn theo hợp đồng gốc. */
    fromAppendixCode: string | null
}

export type ResolvedContractTerms = {
    contractId: string
    at: Date
    paymentTermDays: number | null
    creditLimitOverride: Prisma.Decimal | null
    items: Map<string, ResolvedContractItem>
    /** Các phụ lục đã được áp, cũ đến mới. */
    appliedAppendices: Array<{ code: string; effectiveDate: Date; changeSummary: string | null }>
}

/**
 * Điều khoản hợp đồng có hiệu lực tại một ngày.
 *
 * Phụ lục không sửa đè lên hợp đồng gốc — nó là một lớp phủ có ngày hiệu lực. Điều khoản
 * áp cho một chứng từ được tính bằng cách chồng lần lượt các phụ lục có hiệu lực tính đến
 * ngày của chứng từ đó lên hợp đồng gốc.
 *
 * Đây là lý do phải làm vậy: giá sàn dùng để chấm đơn bán. Nếu phụ lục sửa thẳng vào
 * ContractItem thì giá cũ mất, và đơn của tháng trước khi duyệt lại sẽ bị chấm theo giá
 * sàn của tháng này — báo vi phạm oan cho một đơn vốn đúng.
 */
@Injectable()
export class ContractTermsService {
    constructor(private readonly prisma: PrismaService) {}

    /** So sánh theo NGÀY vì effectiveDate là cột DATE. */
    private startOfDay(at: Date) {
        const day = new Date(at)
        day.setUTCHours(0, 0, 0, 0)
        return day
    }

    async resolveAt(
        contractId: string,
        at: Date,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ): Promise<ResolvedContractTerms | null> {
        const day = this.startOfDay(at)

        const contract = await db.contract.findUnique({
            where: { id: contractId },
            select: {
                id: true,
                paymentTermDays: true,
                creditLimitOverride: true,
                items: true,
                appendices: {
                    where: { effectiveDate: { lte: day } },
                    orderBy: { effectiveDate: 'asc' },
                    include: { items: true },
                },
            },
        })
        if (!contract) return null

        const items = new Map<string, ResolvedContractItem>()
        for (const item of contract.items) {
            items.set(item.productId, {
                productId: item.productId,
                uom: item.uom,
                price: item.price,
                minQty: item.minQty,
                maxQty: item.maxQty,
                discount: item.discount,
                taxRate: item.taxRate,
                note: item.note,
                fromAppendixCode: null,
            })
        }

        let paymentTermDays = contract.paymentTermDays
        let creditLimitOverride = contract.creditLimitOverride
        const appliedAppendices: ResolvedContractTerms['appliedAppendices'] = []

        // Cũ đến mới: phụ lục sau ghi đè phụ lục trước trên cùng một điều khoản.
        for (const appendix of contract.appendices) {
            appliedAppendices.push({
                code: appendix.code,
                effectiveDate: appendix.effectiveDate,
                changeSummary: appendix.changeSummary,
            })
            // null = phụ lục này không đụng tới điều khoản đó, giữ nguyên giá trị đang có.
            if (appendix.paymentTermDays != null) paymentTermDays = appendix.paymentTermDays
            if (appendix.creditLimitOverride != null) creditLimitOverride = appendix.creditLimitOverride

            for (const item of appendix.items) {
                items.set(item.productId, {
                    productId: item.productId,
                    uom: item.uom,
                    price: item.price,
                    minQty: item.minQty,
                    maxQty: item.maxQty,
                    discount: item.discount,
                    taxRate: item.taxRate,
                    note: item.note,
                    fromAppendixCode: appendix.code,
                })
            }
        }

        return { contractId: contract.id, at: day, paymentTermDays, creditLimitOverride, items, appliedAppendices }
    }

    /** Giá sàn của một sản phẩm tại một ngày; null nếu hợp đồng không quy định giá cho nó. */
    async floorPriceAt(
        contractId: string,
        productId: string,
        at: Date,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ): Promise<{ price: Prisma.Decimal; fromAppendixCode: string | null } | null> {
        const terms = await this.resolveAt(contractId, at, db)
        const item = terms?.items.get(productId)
        return item ? { price: item.price, fromAppendixCode: item.fromAppendixCode } : null
    }
}
