import { IsOptional, IsString, MaxLength } from 'class-validator'
import { Transform } from 'class-transformer'

export class UpdateRoleDto {
    @Transform(({ value }): any => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string

    @Transform(({ value }): any => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    desc?: string
}
