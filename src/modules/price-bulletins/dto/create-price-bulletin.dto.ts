// create-price-bulletin.dto.ts
import { Type } from 'class-transformer'
import { IsArray, IsDateString, IsEnum, IsOptional, IsString, ValidateNested, IsUUID, IsNumber } from 'class-validator'
import { PriceBulletinStatus } from '@prisma/client'

export class PriceBulletinItemInputDto {
    @IsUUID()
    productId!: string

    @IsUUID()
    regionId!: string

    @IsNumber()
    price!: number

    @IsOptional()
    @IsString()
    note?: string
}

export class CreatePriceBulletinDto {
    @IsOptional()
    @IsEnum(PriceBulletinStatus)
    status?: PriceBulletinStatus

    @IsDateString()
    effectiveFrom!: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsOptional()
    @IsDateString()
    publishedAt!: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    fileChecksum?: string

    /** Số quyết định của công ty, ví dụ "03.09.2026/TP". */
    @IsOptional()
    @IsString()
    decisionNo?: string

    /** Công văn Bộ Công Thương làm căn cứ, ví dụ "7010/BCT-TTTN". */
    @IsOptional()
    @IsString()
    basisDocNo?: string

    @IsOptional()
    @IsDateString()
    basisDocDate?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PriceBulletinItemInputDto)
    items!: PriceBulletinItemInputDto[]
}
