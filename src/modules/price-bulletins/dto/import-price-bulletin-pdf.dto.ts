import { IsArray, IsNotEmpty, IsOptional, IsString, ValidateNested, IsNumber, IsBoolean, IsISO8601 } from 'class-validator'
import { Type } from 'class-transformer'

export class ImportPricePdfPreviewDto {
    @IsOptional()
    @IsString()
    effectiveFrom?: string
}

export class ImportPricePdfLineDto {
    @IsString()
    @IsNotEmpty()
    productId!: string

    @IsString()
    @IsNotEmpty()
    regionId!: string

    @IsNumber()
    price!: number
}

export class ImportPricePdfDto {
    @IsString()
    @IsNotEmpty()
    effectiveFrom!: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ImportPricePdfLineDto)
    lines!: ImportPricePdfLineDto[]
}

export class ImportPricePdfCommitDto {
    @IsString()
    effectiveFrom!: string

    @IsOptional()
    @IsString()
    note?: string
}
export class CommitImportLineDto {
    @IsString() @IsNotEmpty() productId!: string
    @IsString() @IsNotEmpty() regionId!: string
    @IsNumber() @IsNotEmpty() price!: number
}

export class CommitImportDto {
    @IsISO8601() @IsNotEmpty() effectiveFrom!: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CommitImportLineDto)
    lines!: CommitImportLineDto[]

    @IsBoolean()
    isOverride!: boolean
}
