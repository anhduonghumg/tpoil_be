import { IsEnum, IsOptional, IsString } from 'class-validator'
import { QtyUom } from '@prisma/client'

export class ProductCreateDto {
    @IsOptional()
    @IsString()
    code?: string

    @IsString()
    name!: string

    @IsString()
    nameMisa?: string

    @IsOptional()
    @IsEnum(QtyUom)
    uom?: QtyUom
}
