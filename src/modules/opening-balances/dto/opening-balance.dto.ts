import { Type } from 'class-transformer'
import {
    IsArray,
    IsDateString,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'
import {
    OpeningDebtBalanceType,
    OpeningDebtSide,
    OpeningInventoryLineKind,
    SalesOrderSupplySource,
} from '@prisma/client'

export class CreateOpeningBalanceBatchDto {
    @IsUUID()
    legalEntityId!: string

    @IsDateString()
    cutoverDate!: string

    @IsOptional()
    @IsString()
    @MaxLength(200)
    sourceSystem?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UpdateOpeningBalanceBatchDto {
    @IsOptional()
    @IsUUID()
    legalEntityId?: string

    @IsOptional()
    @IsDateString()
    cutoverDate?: string

    @IsOptional()
    @IsString()
    @MaxLength(200)
    sourceSystem?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class OpeningInventoryLineDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    lineNo?: number

    @IsEnum(OpeningInventoryLineKind)
    kind!: OpeningInventoryLineKind

    @IsOptional()
    @IsUUID()
    warehouseId?: string

    @IsOptional()
    @IsUUID()
    warehouseAreaId?: string

    @IsUUID()
    productId!: string

    @IsUUID()
    ownerPartyId!: string

    @IsOptional()
    @IsUUID()
    supplierPartyId?: string

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsEnum(SalesOrderSupplySource)
    releaseCode?: SalesOrderSupplySource

    @IsOptional()
    @IsString()
    legacyLotNo?: string

    @IsOptional()
    @IsString()
    legacyReference?: string

    @IsOptional()
    @IsDateString()
    receivedAt?: string

    @IsOptional()
    @IsDateString()
    expectedAt?: string

    @IsOptional()
    @IsDateString()
    expiresAt?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    actualQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    v15Qty?: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    unitCost?: number

    @IsOptional()
    @IsString()
    @MaxLength(3)
    currency?: string

    @IsOptional()
    @IsString()
    reason?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class OpeningDebtLineDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    lineNo?: number

    @IsEnum(OpeningDebtSide)
    side!: OpeningDebtSide

    @IsOptional()
    @IsEnum(OpeningDebtBalanceType)
    balanceType?: OpeningDebtBalanceType

    @IsUUID()
    counterpartyPartyId!: string

    @IsOptional()
    @IsUUID()
    accountantEmployeeId?: string

    @IsOptional()
    @IsString()
    legacyDocumentNo?: string

    @IsOptional()
    @IsString()
    legacyReference?: string

    @IsOptional()
    @IsDateString()
    documentDate?: string

    @IsOptional()
    @IsDateString()
    dueDate?: string

    @IsOptional()
    @IsString()
    @MaxLength(3)
    currency?: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    originalAmount!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    settledAmount?: number

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    outstandingAmount!: number

    @IsOptional()
    @IsString()
    note?: string
}

export class ReplaceOpeningBalanceLinesDto {
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OpeningInventoryLineDto)
    inventoryLines!: OpeningInventoryLineDto[]

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => OpeningDebtLineDto)
    debtLines!: OpeningDebtLineDto[]
}

export class ListOpeningBalanceBatchesDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    pageSize?: number

    @IsOptional()
    @IsString()
    keyword?: string
}
