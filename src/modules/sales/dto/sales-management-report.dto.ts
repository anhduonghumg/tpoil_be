import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator'

export class SalesManagementReportQueryDto {
    @IsOptional()
    @IsISO8601()
    dateFrom?: string

    @IsOptional()
    @IsISO8601()
    dateTo?: string

    @IsOptional()
    @IsIn(['ORDER_DATE', 'DELIVERY_DATE'])
    dateBasis: 'ORDER_DATE' | 'DELIVERY_DATE' = 'ORDER_DATE'

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    salesOwnerEmpId?: string

    @IsOptional()
    @IsUUID()
    productId?: string

    @IsOptional()
    @IsUUID()
    warehouseId?: string

    @IsOptional()
    @IsUUID()
    areaId?: string

    @IsOptional()
    @IsIn(['DAY_TRADE', 'SINGLE', 'LOT'])
    kind?: 'DAY_TRADE' | 'SINGLE' | 'LOT'

    @IsOptional()
    @IsIn(['FINAL', 'PROVISIONAL', 'NO_COST_BASIS'])
    costStatus?: 'FINAL' | 'PROVISIONAL' | 'NO_COST_BASIS'

    @IsOptional()
    @Transform(({ value }) => value === true || value === 'true')
    @IsBoolean()
    lossOnly?: boolean

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page = 1

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(10)
    @Max(100)
    limit = 20
}
