import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateWarehouseAreaDto {
    @IsString()
    @IsNotEmpty()
    code!: string

    @IsString()
    @IsNotEmpty()
    name!: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    sortOrder?: number

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}

export class UpdateWarehouseAreaDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    sortOrder?: number

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}
