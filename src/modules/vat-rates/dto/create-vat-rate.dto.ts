import { Type } from 'class-transformer'
import { IsBoolean, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator'

export class CreateVatRateDto {
    @IsString()
    name!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @Max(100)
    rate!: number

    @IsOptional()
    @IsBoolean()
    isExempt?: boolean

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsBoolean()
    isDefault?: boolean

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    sortOrder?: number
}
