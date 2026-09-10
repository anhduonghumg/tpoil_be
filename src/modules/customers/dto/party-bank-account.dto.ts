import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator'

/**
 * Một tài khoản ngân hàng của đối tác. Một nhà cung cấp thường có nhiều tài khoản —
 * mỗi ngân hàng một số, hoặc tách theo pháp nhân — nên đề nghị thanh toán phải chọn
 * được tài khoản thụ hưởng chứ không dùng chung một số duy nhất trên hồ sơ.
 */
export class PartyBankAccountInputDto {
    /** Có id = sửa dòng cũ; bỏ trống = thêm mới. */
    @IsOptional()
    @IsString()
    id?: string

    @IsString()
    @MinLength(1)
    @MaxLength(150)
    bankName!: string

    @IsOptional()
    @IsString()
    @MaxLength(20)
    bankCode?: string | null

    @IsString()
    @MinLength(1)
    @MaxLength(50)
    accountNo!: string

    @IsString()
    @MinLength(1)
    @MaxLength(255)
    accountName!: string

    /** Tài khoản được điền sẵn khi lập đề nghị thanh toán. Mỗi đối tác chỉ một. */
    @IsOptional()
    @IsBoolean()
    isDefault?: boolean

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}

export class CreatePartyBankAccountDto extends PartyBankAccountInputDto {}

export class UpdatePartyBankAccountDto {
    @IsOptional()
    @IsString()
    @MaxLength(150)
    bankName?: string

    @IsOptional()
    @IsString()
    @MaxLength(20)
    bankCode?: string | null

    @IsOptional()
    @IsString()
    @MaxLength(50)
    accountNo?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    accountName?: string

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}
