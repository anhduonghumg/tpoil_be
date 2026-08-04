import { Type } from 'class-transformer'
import { IsDateString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class ListCommercialRetailQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsString()
    lifecycle?: string

    @IsOptional()
    @IsDateString()
    dateFrom?: string

    @IsOptional()
    @IsDateString()
    dateTo?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number
}
