// lọc + phân trang danh sách HĐ
import { Transform } from 'class-transformer'
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator'
import { ContractStatus, ContractType } from '@prisma/client'

export class ContractListQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsString()
    customerId?: string

    @IsOptional()
    @IsEnum(ContractType)
    type?: ContractType

    @IsOptional()
    @IsEnum(ContractStatus)
    status?: ContractStatus

    @IsOptional()
    @IsDateString()
    startFrom?: string

    @IsOptional()
    @IsDateString()
    startTo?: string

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
