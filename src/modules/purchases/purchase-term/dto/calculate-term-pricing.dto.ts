import { FxStage, PurchaseCostType, QtyBasis } from '@prisma/client'

import { Type } from 'class-transformer'

import { IsArray, IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'

export class TermPricingReceiptInputDto {
    @IsUUID()
    goodsReceiptId!: string

    @IsOptional()
    @IsNumber()
    qtyActualUsed?: number

    @IsOptional()
    @IsNumber()
    qtyV15Used?: number
}

export class TermPricingPriceDayInputDto {
    @IsDateString()
    quoteDate!: string

    @IsNumber()
    priceUsdPerBbl!: number
}

export class TermPricingLineInputDto {
    @IsUUID()
    purchaseOrderLineId!: string

    @IsOptional()
    @IsNumber()
    qtyActual?: number

    @IsOptional()
    @IsNumber()
    qtyV15?: number

    @IsOptional()
    @IsString()
    note?: string
}

export class TermPricingCostInputDto {
    @IsEnum(PurchaseCostType)
    costType!: PurchaseCostType

    @IsNumber()
    amountVnd!: number

    @IsOptional()
    @IsString()
    sourceDocNo?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class CalculateTermPricingDto {
    @IsDateString()
    billDate!: string

    @IsEnum(QtyBasis)
    qtyBasisSelected!: QtyBasis

    @IsOptional()
    @IsBoolean()
    qtyBasisLocked?: boolean

    @IsOptional()
    @IsNumber()
    mopsAvgUsdPerBbl?: number

    @IsOptional()
    @IsNumber()
    premiumUsdPerBbl?: number

    @IsOptional()
    @IsDateString()
    plattsBaseDate?: string

    @IsOptional()
    @IsNumber()
    plattsDaysBefore?: number

    @IsOptional()
    @IsNumber()
    plattsDaysAfter?: number

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermPricingPriceDayInputDto)
    priceDays?: TermPricingPriceDayInputDto[]

    @IsOptional()
    @IsDateString()
    fxRateDate?: string

    @IsOptional()
    @IsEnum(FxStage)
    fxStage?: FxStage

    @IsOptional()
    @IsNumber()
    fxRate?: number

    @IsOptional()
    @IsNumber()
    envTaxAmountVnd?: number

    @IsOptional()
    @IsNumber()
    vatAmountVnd?: number

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermPricingReceiptInputDto)
    receipts?: TermPricingReceiptInputDto[]

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermPricingLineInputDto)
    lines!: TermPricingLineInputDto[]

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermPricingCostInputDto)
    costs?: TermPricingCostInputDto[]
}
