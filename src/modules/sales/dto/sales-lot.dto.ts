import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'

export class CreateLotAdjustmentDto {
    @IsUUID()
    salesOrderLineId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    qty!: number

    @IsString()
    @MaxLength(1000)
    reason!: string
}

export class DecideLotAdjustmentDto {
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    decisionNote?: string
}

export class CustomerStockQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    productId?: string
}

export class WithdrawalLineDto {
    @IsUUID()
    productId!: string

    @IsUUID()
    warehouseId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    requestedQty!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    requestedV15Qty?: number
}

export class CreateWithdrawalDto {
    @IsUUID()
    customerPartyId!: string

    /** Optional at creation: the system proposes matching lot orders, sales confirms. */
    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    @IsOptional()
    @IsDateString()
    requestDate?: string

    @IsString()
    @MaxLength(30)
    vehiclePlate!: string

    @IsString()
    @MaxLength(255)
    driverName!: string

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    note?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => WithdrawalLineDto)
    lines!: WithdrawalLineDto[]
}

export class SelectWithdrawalSourceDto {
    @IsUUID()
    salesOrderId!: string
}

export class WithdrawalSourceQueryDto {
    @IsUUID()
    customerPartyId!: string

    @IsUUID()
    productId!: string

    @IsOptional()
    @IsUUID()
    warehouseId?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    qty?: number
}

export class ListWithdrawalsQueryDto {
    @IsOptional()
    @IsString()
    status?: string

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    salesOrderId?: string

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

export class CancelWithdrawalDto {
    @IsOptional()
    @IsString()
    @MaxLength(1000)
    reason?: string
}
