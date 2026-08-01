import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    Min,
    ValidateNested,
} from 'class-validator'
import { CommercialLotWithdrawalStatus } from '@prisma/client'

export class ListCommercialLotsQueryDto {
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

export class ListLotWithdrawalsQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsEnum(CommercialLotWithdrawalStatus)
    status?: CommercialLotWithdrawalStatus

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

export class CreateCommercialLotWithdrawalLineDto {
    @IsUUID()
    commercialLotPositionId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    actualQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    v15Qty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    temperatureC?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    density?: number
}

export class CreateCommercialLotWithdrawalDto {
    @IsString()
    withdrawalNo!: string

    @IsUUID()
    destinationWarehouseId!: string

    @IsDateString()
    withdrawalDate!: string

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateCommercialLotWithdrawalLineDto)
    lines!: CreateCommercialLotWithdrawalLineDto[]
}
