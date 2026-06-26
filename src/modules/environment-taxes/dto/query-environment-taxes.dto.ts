import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'

export class QueryEnvironmentTaxesDto {
    @IsOptional()
    @IsUUID()
    productId?: string

    @IsOptional()
    @IsString()
    status?: string

    @IsOptional()
    @IsDateString()
    fromDate?: string

    @IsOptional()
    @IsDateString()
    toDate?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(200)
    pageSize?: number
}
