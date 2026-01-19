// src/modules/settlements/supplier-settlements/dto/supplier-settlement.dto.ts
import { IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID } from 'class-validator'
import { SettlementType } from '@prisma/client'

export class CreateSupplierSettlementDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsEnum(SettlementType)
    type!: SettlementType

    @IsNumber()
    amountTotal!: number

    @IsOptional()
    @IsDateString()
    dueDate?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class AllocateSettlementDto {
    @IsUUID()
    bankTransactionId!: string

    @IsNumber()
    allocatedAmount!: number

    @IsOptional()
    @IsString()
    note?: string
}

export class ListSupplierSettlementsQueryDto {
    @IsOptional()
    @IsUUID()
    supplierCustomerId?: string

    @IsOptional()
    @IsEnum(SettlementType)
    type?: SettlementType

    @IsOptional()
    @IsString()
    status?: string
    @IsOptional()
    @IsDateString()
    dueFrom?: string

    @IsOptional()
    @IsDateString()
    dueTo?: string

    @IsOptional()
    @IsInt()
    page?: number

    @IsOptional()
    @IsInt()
    limit?: number
}
