import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class CreateBankImportTemplateDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(50)
    bankCode!: string

    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name!: string

    @IsOptional()
    @Transform(({ value }) => Number(value))
    @IsInt()
    @Min(1)
    version?: number

    @IsObject()
    columnMap!: Record<string, any>

    @IsOptional()
    @IsObject()
    normalizeRule?: Record<string, any>

    @IsOptional()
    @Transform(({ value }): boolean => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    isActive?: boolean
}
