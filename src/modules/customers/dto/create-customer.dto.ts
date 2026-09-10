import { Transform, Type } from 'class-transformer'
import {
    IsArray,
    IsBoolean,
    IsDate,
    IsDateString,
    IsEmail,
    IsEnum,
    IsIn,
    IsOptional,
    IsString,
    MaxLength,
    ValidateNested,
} from 'class-validator'
import { CustomerRole, CustomerStatus, PartyRoleType, PartyType, TaxSource } from '@prisma/client'
import { PartyBankAccountInputDto } from './party-bank-account.dto'

export class CreateCustomerDto {
    @IsOptional()
    @IsString()
    @MaxLength(50)
    code?: string

    @IsString()
    @MaxLength(255)
    name!: string

    @IsOptional()
    @IsString()
    @MaxLength(50)
    taxCode?: string

    @IsOptional()
    @IsBoolean()
    taxVerified?: boolean

    @IsOptional()
    @IsEnum(TaxSource)
    taxSource?: TaxSource

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    taxSyncedAt?: Date

    /**
     * @deprecated Bộ vai trò Đại lý/Bán lẻ/Bán buôn đã bị loại thương nhân xăng dầu thay thế.
     * Vẫn nhận để client cũ không vỡ, nhưng không còn được ghi xuống DB.
     */
    @Transform(({ value }) => (value == null || Array.isArray(value) ? value : [value]))
    @IsOptional()
    @IsArray()
    @IsEnum(CustomerRole, { each: true })
    roles?: CustomerRole[]

    @IsOptional()
    @IsArray()
    /**
     * Legacy clients used this field for the complete partner-role picker and
     * therefore may send CUSTOMER/SUPPLIER or a merchant role (TNPP/TNDM/TNDL)
     * alongside the operational roles. The service normalizes these values and
     * derives CUSTOMER/SUPPLIER from merchantRole when applicable.
     */
    @IsEnum(PartyRoleType, { each: true })
    partnerRoles?: PartyRoleType[]

    @IsOptional()
    @IsString()
    billingAddress?: string

    @IsOptional()
    @IsString()
    shippingAddress?: string

    @IsOptional()
    @IsEmail()
    contactEmail?: string

    @IsOptional()
    @IsString()
    contactPhone?: string

    /**
     * Danh sách tài khoản ngân hàng của đối tác. Thay cho ô số tài khoản đơn lẻ cũ:
     * đề nghị thanh toán chọn tài khoản thụ hưởng từ đây.
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PartyBankAccountInputDto)
    bankAccounts?: PartyBankAccountInputDto[]

    @IsOptional()
    @IsEnum(CustomerStatus)
    status?: CustomerStatus

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    salesOwnerEmpId?: string

    @IsOptional()
    @IsString()
    accountingOwnerEmpId?: string

    @IsOptional()
    @IsString()
    legalOwnerEmpId?: string

    @IsOptional()
    @IsEnum(PartyType)
    partyType?: PartyType

    /**
     * Loại thương nhân xăng dầu. Khi có, hệ thống tự sinh CUSTOMER/SUPPLIER tương ứng
     * nên không cần tick tay isCustomer/isSupplier nữa.
     */
    @IsOptional()
    @IsIn([PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] as string[])
    merchantRole?: 'TNPP' | 'TNDM' | 'TNDL' | null

    /**
     * Ngày loại thương nhân bắt đầu có hiệu lực. Phân loại đổi theo từng năm và chứng từ
     * cũ phải đọc theo loại tại thời điểm của nó, nên kỳ mới cần ngày riêng chứ không
     * mặc định là hôm nay. Bỏ trống = áp dụng từ hôm nay.
     */
    @IsOptional()
    @IsDateString()
    merchantEffectiveFrom?: string

    @IsOptional()
    @IsBoolean()
    isCustomer?: boolean

    @IsOptional()
    @IsBoolean()
    isSupplier?: boolean

    @IsOptional()
    @IsBoolean()
    isInternal?: boolean

    @IsOptional()
    @IsString()
    groupId?: string | null

    @IsOptional()
    @IsString()
    documentOwnerEmpId?: string | null
}
