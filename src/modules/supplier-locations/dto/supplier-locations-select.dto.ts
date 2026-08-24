import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'

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

    // Query string tới đây vẫn là chuỗi: Boolean('false') === true, nên phải tự đổi.
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    isActive?: boolean
}
