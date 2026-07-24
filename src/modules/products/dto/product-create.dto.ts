import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import { QtyUom } from '@prisma/client'

export class ProductCreateDto {
    @IsString()
    @IsNotEmpty()
    code!: string

    @IsString()
    name!: string

    @IsString()
    nameMisa?: string

    @IsOptional()
    @IsEnum(QtyUom)
    uom?: QtyUom
}
