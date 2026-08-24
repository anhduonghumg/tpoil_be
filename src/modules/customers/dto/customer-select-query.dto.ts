import { Type } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { PartyType } from '@prisma/client'

export enum CustomerSelectRole {
    CUSTOMER = 'CUSTOMER',
    SUPPLIER = 'SUPPLIER',
    INTERNAL = 'INTERNAL',
    SHIP_OWNER = 'SHIP_OWNER',
    SEA_CARRIER = 'SEA_CARRIER',
    INSURER = 'INSURER',
    SURVEYOR = 'SURVEYOR',
    SHIPPING_AGENT = 'SHIPPING_AGENT',

    /**
     * Lọc theo chiều giao dịch xăng dầu — chỉ hiện đúng đối tác đặt được chứng từ, thay
     * vì để người dùng chọn rồi mới báo lỗi ở bước gửi duyệt.
     * SELLABLE = TNPP + TNDL, PURCHASABLE = TNPP + TNDM.
     */
    SELLABLE = 'SELLABLE',
    PURCHASABLE = 'PURCHASABLE',

    /** Äá»‘i tÃ¡c kinh doanh dÃ¹ng chung cho cáº¥u hÃ¬nh váº­n hÃ nh (khÃ¡ch hÃ ng hoáº·c nhÃ  cung cáº¥p). */
    PARTNER = 'PARTNER',
}

export class CustomerSelectQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(PartyType)
    partyType?: PartyType

    @IsOptional()
    @IsEnum(CustomerSelectRole)
    role?: CustomerSelectRole

    /** NgÃ y chÃ­nh xÃ¡c cáº§n xÃ©t hiá»‡u lá»±c loáº¡i thÆ°Æ¡ng nhÃ¢n. */
    @IsOptional()
    @IsDateString()
    effectiveAt?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pageSize?: number = 50
}
