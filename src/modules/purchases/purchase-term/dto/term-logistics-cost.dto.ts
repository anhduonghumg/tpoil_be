import { TermCostAllocationBasis, TermLogisticsCostType } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'
import { PartialType } from '@nestjs/mapped-types'

export class TermLogisticsCostLineDto {
    @IsEnum(TermLogisticsCostType)
    costType!: TermLogisticsCostType

    @IsOptional()
    @IsUUID()
    productId?: string | null

    @IsOptional()
    @IsUUID()
    purchaseOrderLineId?: string | null

    @IsOptional()
    @IsUUID()
    goodsReceiptId?: string | null

    @IsOptional()
    @IsEnum(TermCostAllocationBasis)
    allocationBasis?: TermCostAllocationBasis

    @IsNumber()
    @Min(0.01)
    amountBeforeVat!: number

    @IsOptional()
    @IsNumber()
    @Min(0)
    vatRate?: number

    @IsOptional()
    @IsBoolean()
    isCapitalizedToCost?: boolean

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsNumber()
    sortOrder?: number
}

export class CreateTermLogisticsCostDto {
    @IsOptional()
    @IsUUID()
    shipmentId?: string | null

    @IsOptional()
    @IsUUID()
    vendorCustomerId?: string | null

    @IsOptional()
    @IsString()
    documentNo?: string

    @IsOptional()
    @IsDateString()
    documentDate?: string

    @IsOptional()
    @IsString()
    currency?: string

    @IsOptional()
    @IsNumber()
    @Min(0.000001)
    fxRate?: number

    @IsOptional()
    @IsString()
    note?: string

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermLogisticsCostLineDto)
    lines!: TermLogisticsCostLineDto[]
}

export class UpdateTermLogisticsCostDto extends PartialType(CreateTermLogisticsCostDto) {}
