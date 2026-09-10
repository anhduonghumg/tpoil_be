import { IsArray, IsOptional, IsUUID, IsEnum, IsInt, IsDateString, IsString } from 'class-validator'
import { ContractKind, ContractStatus, RiskLevel } from '@prisma/client'
import { Transform, Type } from 'class-transformer'

export class ContractListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsUUID()
    customerId?: string

    @IsOptional()
    @IsUUID()
    contractTypeId?: string

    /**
     * Loại hợp đồng KHÔNG muốn thấy trong danh sách.
     *
     * Màn hợp đồng chung dùng để loại hợp đồng thuê kho: loại đó có màn quản lý riêng
     * (kèm gán kho) và bị chính form ở đây loại khỏi ô "Loại HĐ", nên nếu vẫn liệt kê thì
     * bấm Sửa sẽ mở một form không chọn lại được đúng loại của nó.
     */
    @IsOptional()
    @Transform(({ value }) => (value == null || Array.isArray(value) ? value : [value]))
    @IsArray()
    @IsString({ each: true })
    excludeTypeCodes?: string[]

    @IsOptional()
    @IsEnum(ContractStatus)
    status?: ContractStatus

    @IsOptional()
    @IsEnum(RiskLevel)
    riskLevel?: RiskLevel

    @IsOptional()
    @IsEnum(ContractKind)
    kind?: ContractKind

    @IsOptional()
    @IsDateString()
    startFrom?: string

    @IsOptional()
    @IsDateString()
    startTo?: string

    @IsOptional()
    @IsDateString()
    endFrom?: string

    @IsOptional()
    @IsDateString()
    endTo?: string

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    page?: number = 1

    @Type(() => Number)
    @IsOptional()
    @IsInt()
    pageSize?: number = 20
}
