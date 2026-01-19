import { IsBooleanString, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator'
import { Transform } from 'class-transformer'

export class ListSupplierLocationsDto {
    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsBooleanString()
    isActive?: string

    @IsOptional()
    @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Transform(({ value }) => (value !== undefined ? Number(value) : undefined))
    @IsInt()
    @Min(1)
    pageSize?: number
}
