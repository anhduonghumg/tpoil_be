import { IsDateString, IsIn, IsOptional } from 'class-validator'
import { PartyRoleType } from '@prisma/client'

const MERCHANT_VALUES = [PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] as const

export class SetMerchantRoleDto {
    /**
     * Bỏ trống = đối tác không phải thương nhân xăng dầu (đơn vị dịch vụ, nội bộ...).
     * Khi đó CUSTOMER/SUPPLIER sinh ra từ loại thương nhân cũ sẽ được đóng kỳ.
     */
    @IsOptional()
    @IsIn(MERCHANT_VALUES as unknown as string[])
    merchantRole?: (typeof MERCHANT_VALUES)[number] | null

    /** Áp dụng từ ngày nào; bỏ trống thì tính từ hôm nay. */
    @IsOptional()
    @IsDateString()
    effectiveFrom?: string
}
