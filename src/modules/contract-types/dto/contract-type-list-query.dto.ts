import { Transform } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator'

export class ContractTypeListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : null))
    @IsBoolean()
    isActive?: boolean | null

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    page?: number = 1

    @IsOptional()
    @Transform(({ value }) => parseInt(value, 10))
    @IsInt()
    @Min(1)
    pageSize?: number = 20
}
