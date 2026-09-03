import { BadRequestException, Injectable } from '@nestjs/common'
import { PartyRoleType, Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

/** Ba loại thương nhân xăng dầu; các vai trò khác không thuộc trục này. */
export const MERCHANT_ROLES = [
    PartyRoleType.TNPP,
    PartyRoleType.TNDM,
    PartyRoleType.TNDL,
] as const

export type MerchantRole = (typeof MERCHANT_ROLES)[number]

/** Bán cho ai được: TNPP (mua bán hai chiều) và TNDL (chỉ bán cho họ). */
export const SELLABLE_ROLES: MerchantRole[] = [PartyRoleType.TNPP, PartyRoleType.TNDL]

/** Mua của ai được: TNPP và TNDM (chỉ mua của họ). */
export const PURCHASABLE_ROLES: MerchantRole[] = [PartyRoleType.TNPP, PartyRoleType.TNDM]

export const MERCHANT_LABELS: Record<MerchantRole, string> = {
    TNPP: 'Thương nhân phân phối',
    TNDM: 'Thương nhân đầu mối',
    TNDL: 'Thương nhân đại lý',
}

/**
 * Vai trò CUSTOMER/SUPPLIER mà mỗi loại thương nhân sinh ra. Người dùng chỉ khai loại
 * thương nhân; hai vai trò này do hệ thống giữ đồng bộ để mọi truy vấn cũ vẫn chạy.
 */
export const MERCHANT_DERIVED_ROLES: Record<MerchantRole, PartyRoleType[]> = {
    TNPP: [PartyRoleType.CUSTOMER, PartyRoleType.SUPPLIER],
    TNDM: [PartyRoleType.SUPPLIER],
    TNDL: [PartyRoleType.CUSTOMER],
}

/**
 * Loại thương nhân của đối tác, có hiệu lực theo thời gian.
 *
 * Dùng chính bảng PartyRole vì nó đã có validFrom/validTo: một đối tác có thể là TNDL
 * một giai đoạn rồi thành TNPP, và chứng từ cũ phải được xét theo phân loại tại thời
 * điểm của chứng từ chứ không phải theo hôm nay.
 */
@Injectable()
export class PartyMerchantService {
    constructor(private readonly prisma: PrismaService) {}

    /** So sánh theo NGÀY vì validFrom/validTo là cột DATE. */
    private startOfDay(at: Date) {
        const day = new Date(at)
        // PostgreSQL DATE được Prisma biểu diễn bằng 00:00:00 UTC. Dùng setHours()
        // sẽ quy đổi qua múi giờ máy chủ (UTC+7 thành 17:00 ngày hôm trước) và bỏ sót
        // các vai trò bắt đầu đúng ngày chứng từ. Luôn chuẩn hóa theo UTC.
        day.setUTCHours(0, 0, 0, 0)
        return day
    }

    private activeAtWhere(at: Date): Prisma.PartyRoleWhereInput {
        const day = this.startOfDay(at)
        return {
            validFrom: { lte: day },
            OR: [{ validTo: null }, { validTo: { gte: day } }],
        }
    }

    /** Loại thương nhân của một đối tác tại một thời điểm; null nếu không phải thương nhân. */
    async merchantRoleAt(
        partyId: string,
        at: Date = new Date(),
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ): Promise<MerchantRole | null> {
        const row = await db.partyRole.findFirst({
            where: { partyId, role: { in: [...MERCHANT_ROLES] }, ...this.activeAtWhere(at) },
            orderBy: { validFrom: 'desc' },
            select: { role: true },
        })
        return (row?.role as MerchantRole) ?? null
    }

    /** Điều kiện lọc đối tác bán được / mua được tại một thời điểm. */
    tradableWhere(direction: 'SELL' | 'BUY', at: Date = new Date()): Prisma.PartyWhereInput {
        const roles = direction === 'SELL' ? SELLABLE_ROLES : PURCHASABLE_ROLES
        return { roles: { some: { role: { in: roles }, ...this.activeAtWhere(at) } } }
    }

    /**
     * Chặn đặt sai chiều: không bán cho thương nhân đầu mối, không mua của thương nhân
     * đại lý. Xét theo phân loại tại ngày chứng từ.
     */
    async assertCanTrade(
        partyId: string,
        direction: 'SELL' | 'BUY',
        at: Date,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ) {
        // A draft document may have been entered with an earlier date before
        // the counterparty was classified. If there is no historical role at
        // that date, use the currently selected classification; once a
        // historical classification exists, it remains authoritative.
        const roleAtDocumentDate = await this.merchantRoleAt(partyId, at, db)
        const role = roleAtDocumentDate ?? (await this.merchantRoleAt(partyId, new Date(), db))
        const allowed = direction === 'SELL' ? SELLABLE_ROLES : PURCHASABLE_ROLES
        if (role && allowed.includes(role)) return role

        const party = await db.party.findUnique({ where: { id: partyId }, select: { name: true } })
        const verb = direction === 'SELL' ? 'bán cho' : 'mua của'
        const allowedText = allowed.map((r) => MERCHANT_LABELS[r]).join(' hoặc ')
        throw new BadRequestException({
            code: direction === 'SELL' ? 'PARTY_NOT_SELLABLE' : 'PARTY_NOT_PURCHASABLE',
            message: role
                ? `Không ${verb} ${party?.name ?? 'đối tác này'} được: họ là ${MERCHANT_LABELS[role]}, chỉ ${allowedText} mới hợp lệ.`
                : `${party?.name ?? 'Đối tác này'} chưa được phân loại thương nhân xăng dầu — phải là ${allowedText} mới ${verb} được.`,
            detail: { partyId, merchantRole: role },
        })
    }

    /**
     * Đặt loại thương nhân từ một ngày. Đóng kỳ của loại cũ và của các vai trò suy ra
     * không còn đúng, rồi mở kỳ mới — nhờ vậy lịch sử đọc lại được.
     */
    async setMerchantRole(
        partyId: string,
        role: MerchantRole | null,
        effectiveFrom: Date,
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ) {
        const day = this.startOfDay(effectiveFrom)
        const current = await db.partyRole.findMany({
            where: { partyId, validTo: null },
            select: { id: true, role: true, validFrom: true },
        })

        const nextDerived = role ? MERCHANT_DERIVED_ROLES[role] : []
        const keep = new Set<PartyRoleType>([...(role ? [role] : []), ...nextDerived])

        // CUSTOMER/SUPPLIER chỉ thuộc quyền quản của hệ thống khi chúng ĐƯỢC SUY RA từ
        // loại thương nhân trước đó. Đối tác dịch vụ (vận tải, giám định...) được tick
        // tay hai vai trò này mà không thuộc loại thương nhân nào — đụng vào là cắt mất
        // quan hệ đang có của họ.
        const previous = current
            .map((row) => row.role)
            .find((r): r is MerchantRole => MERCHANT_ROLES.includes(r as MerchantRole))
        const derivedBefore: PartyRoleType[] = previous ? MERCHANT_DERIVED_ROLES[previous] : []

        for (const existing of current) {
            const isManaged =
                MERCHANT_ROLES.includes(existing.role as MerchantRole) ||
                derivedBefore.includes(existing.role)
            if (!isManaged || keep.has(existing.role)) continue
            // Kỳ mới bắt đầu từ `day` nên kỳ cũ đóng ngay trước đó.
            const validTo = new Date(day)
            validTo.setUTCDate(validTo.getUTCDate() - 1)
            await db.partyRole.update({
                where: { id: existing.id },
                data: { validTo: validTo < existing.validFrom ? existing.validFrom : validTo },
            })
        }

        const stillOpen = new Set(
            current.filter((row) => keep.has(row.role)).map((row) => row.role),
        )
        for (const wanted of keep) {
            if (stillOpen.has(wanted)) continue
            await db.partyRole.upsert({
                where: { partyId_role_validFrom: { partyId, role: wanted, validFrom: day } },
                create: { partyId, role: wanted, validFrom: day },
                update: { validTo: null },
            })
        }
    }

    /** Lịch sử phân loại: loại nào áp dụng từ khi nào đến khi nào. */
    async merchantHistory(partyId: string) {
        const rows = await this.prisma.partyRole.findMany({
            where: { partyId, role: { in: [...MERCHANT_ROLES] } },
            orderBy: { validFrom: 'desc' },
            select: { id: true, role: true, validFrom: true, validTo: true, note: true },
        })
        const today = this.startOfDay(new Date())
        return rows.map((row) => ({
            ...row,
            label: MERCHANT_LABELS[row.role as MerchantRole],
            isCurrent: row.validFrom <= today && (row.validTo == null || row.validTo >= today),
        }))
    }
}
