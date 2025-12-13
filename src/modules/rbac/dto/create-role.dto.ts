import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { Transform } from 'class-transformer'

export class CreateRoleDto {
    @Transform(({ value }): any => (typeof value === 'string' ? value.trim().toLowerCase() : value))
    @IsString()
    @IsNotEmpty()
    @MaxLength(64)
    @Matches(/^[a-z0-9._-]+$/, {
        message: 'code chỉ cho phép a-z 0-9 . _ - (không có khoảng trắng)',
    })
    code!: string

    @Transform(({ value }): any => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @IsNotEmpty()
    @MaxLength(255)
    name!: string

    @Transform(({ value }): any => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    desc?: string
}
