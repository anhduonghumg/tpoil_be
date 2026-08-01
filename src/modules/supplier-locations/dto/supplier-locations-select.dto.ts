import { Type } from 'class-transformer'
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'

export class SupplierLocationsSelectQueryDto {
    // Optional: sales orders pick a warehouse before any supplier is known.
    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limit?: number

    @IsOptional()
    @Type(() => Boolean)
    isActive?: boolean
}
