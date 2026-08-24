import { Transform, Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'
import { SalesDiscountBoardStatus } from '@prisma/client'

/** Boolean('false') === true, nên cờ trên query string phải parse tay. */
const parseBool = ({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value

export class DiscountBoardLineDto {
    @IsUUID()
    warehouseId!: string

    @IsUUID()
    productId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    discountPerUnit!: number

    @IsOptional()
    @IsString()
    @MaxLength(255)
    note?: string
}

export class CreateDiscountBoardDto {
    @IsDateString()
    effectiveFrom!: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    announcerName?: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string

    /**
     * Chép từ bản nào. Bỏ trống thì chép bản đang có hiệu lực; chỉ rõ khi cần "ra bản sửa
     * lại" cho một bản đã phát hành sai.
     */
    @IsOptional()
    @IsUUID()
    cloneFromBoardId?: string

    /**
     * Bỏ trống thì hệ thống chép theo quy tắc trên — vận hành chỉ việc sửa ô nào đổi,
     * đúng cảnh "một ngày đổi vài lần".
     */
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DiscountBoardLineDto)
    lines?: DiscountBoardLineDto[]
}

export class UpdateDiscountBoardDto {
    @IsOptional()
    @IsDateString()
    effectiveFrom?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    announcerName?: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => DiscountBoardLineDto)
    lines?: DiscountBoardLineDto[]
}

export class ListDiscountBoardsQueryDto {
    @IsOptional()
    @IsEnum(SalesDiscountBoardStatus)
    status?: SalesDiscountBoardStatus

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

export class SendDiscountBoardDto {
    @IsArray()
    @ArrayMinSize(1)
    @IsUUID(undefined, { each: true })
    customerPartyIds!: string[]

    /** Gửi lại cho cả người đã nhận thành công ở lần trước. */
    @IsOptional()
    @Transform(parseBool)
    @IsBoolean()
    resend?: boolean
}

/** Tra chiết khấu đang áp dụng cho một loạt dòng đơn, để form tự điền. */
export class ResolveDiscountQueryDto {
    @IsUUID()
    warehouseId!: string

    @IsUUID()
    productId!: string

    @IsOptional()
    @IsDateString()
    at?: string
}
