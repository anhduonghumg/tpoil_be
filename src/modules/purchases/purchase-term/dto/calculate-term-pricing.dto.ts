import { FxStage, PricingStageType, QtyBasis } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'

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

export class TermPricingCostInputDto {
    @IsString()
    costType?: string

    @IsNumber()
    amountVnd?: number

    @IsOptional()
    @IsString()
    sourceDocNo?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class CalculateTermPricingDto {
    @IsUUID()
    purchaseOrderLineId!: string

    @IsDateString()
    billDate!: string

    @IsEnum(PricingStageType)
    stageType!: PricingStageType

    @IsEnum(QtyBasis)
    qtyBasisSelected!: QtyBasis

    @IsOptional()
    qtyBasisLocked?: boolean

    @IsOptional()
    @IsNumber()
    qtyActualTotal?: number

    @IsOptional()
    @IsNumber()
    qtyV15Total?: number

    @IsOptional()
    @IsNumber()
    mopsAvgUsdPerBbl?: number

    @IsOptional()
    @IsNumber()
    premiumUsdPerBbl?: number

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

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => TermPricingCostInputDto)
    costs?: TermPricingCostInputDto[]
}
