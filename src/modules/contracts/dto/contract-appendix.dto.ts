import { Type } from 'class-transformer'
import {
    IsArray,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    MinLength,
    ValidateNested,
} from 'class-validator'

/** Giá sàn và điều kiện của một sản phẩm mà phụ lục điều chỉnh. */
export class ContractAppendixItemDto {
    @IsUUID()
    productId!: string

    @IsString()
    @MinLength(1)
    @MaxLength(20)
    uom!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    minQty?: number | null

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    maxQty?: number | null

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    discount?: number | null

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    taxRate?: number | null

    @IsOptional()
    @IsString()
    note?: string | null
}

export class UpsertContractAppendixDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    code!: string

    /**
     * Ngày phụ lục bắt đầu có hiệu lực. Chứng từ trước ngày này vẫn theo điều khoản cũ,
     * nên đừng nhầm với ngày ký.
     */
    @IsDateString()
    effectiveDate!: string

    @IsOptional()
    @IsString()
    changeSummary?: string | null

    @IsOptional()
    @IsString()
    docUrl?: string | null

    /** Bỏ trống = phụ lục không điều chỉnh kỳ thanh toán. */
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number | null

    /** Bỏ trống = phụ lục không điều chỉnh hạn mức. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    creditLimitOverride?: number | null

    /** Chỉ liệt kê sản phẩm CÓ điều chỉnh giá; sản phẩm không nhắc tới giữ nguyên mức cũ. */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ContractAppendixItemDto)
    items?: ContractAppendixItemDto[]
}
