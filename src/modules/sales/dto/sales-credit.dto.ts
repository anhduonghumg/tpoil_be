import { Transform, Type } from 'class-transformer'
import {
    IsBoolean,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
} from 'class-validator'

/** Boolean('false') === true, nên cờ trên query string phải parse tay. */
const parseBool = ({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value

export class ListCreditCustomersQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    /** Kế toán công nợ phụ trách khách hàng — bộ lọc chính của màn hình này. */
    @IsOptional()
    @IsUUID()
    accountingOwnerEmpId?: string

    /** Chỉ khách trả sau nhưng chưa cấu hình hạn mức — việc cần làm của kế toán. */
    @IsOptional()
    @Transform(parseBool)
    @IsBoolean()
    missingLimitOnly?: boolean

    @IsOptional()
    @Transform(parseBool)
    @IsBoolean()
    overdueOnly?: boolean

    /** Đang dùng quá hạn mức. */
    @IsOptional()
    @Transform(parseBool)
    @IsBoolean()
    overLimitOnly?: boolean

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number
}

/**
 * Mọi trường đều tùy chọn, nhưng `null` khác `undefined`: null là xóa hạn mức,
 * undefined là không đụng tới.
 */
export class UpdateCustomerCreditDto {
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    creditLimit?: number | null

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    tempLimit?: number | null

    @IsOptional()
    @IsDateString()
    tempFrom?: string | null

    @IsOptional()
    @IsDateString()
    tempTo?: string | null

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number | null

    /** Bắt buộc: mọi thay đổi hạn mức đều phải giải thích được về sau. */
    @IsString()
    @MaxLength(1000)
    reason!: string
}
