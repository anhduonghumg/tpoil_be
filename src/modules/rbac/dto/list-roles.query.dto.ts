import { Transform } from 'class-transformer'
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator'

export class ListRolesQueryDto {
    @Transform(({ value }) => (value ? Number(value) : 1))
    @IsOptional()
    @IsInt()
    @Min(1)
    page?: number = 1

    @Transform(({ value }) => (value ? Number(value) : 20))
    @IsOptional()
    @IsInt()
    @Min(1)
    @Max(200)
    pageSize?: number = 20

    @Transform(({ value }): any => (typeof value === 'string' ? value.trim() : value))
    @IsOptional()
    @IsString()
    keyword?: string
}
