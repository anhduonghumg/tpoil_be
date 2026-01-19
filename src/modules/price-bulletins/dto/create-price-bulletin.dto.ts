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

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => PriceBulletinItemInputDto)
    items!: PriceBulletinItemInputDto[]
}
