import { Transform, Type } from 'class-transformer'
import {
    IsBoolean,
    IsEnum,
    IsInt,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
} from 'class-validator'
import { ArrayMinSize, IsArray, ValidateNested } from 'class-validator'
import { ReceivableOpenItemStatus } from '@prisma/client'

export class AllocateReceivableDto {
    @IsUUID()
    bankTransactionId!: string

    @IsUUID()
    openItemId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number

    /** Optional caller-supplied key so a retried request cannot double-apply. */
    @IsOptional()
    @IsString()
    @MaxLength(200)
    idempotencyKey?: string
}

export class AllocateReceiptLineDto {
    @IsUUID()
    openItemId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.0001)
    amount!: number
}

/** One inbound bank transaction can settle many receivables. */
export class AllocateBankReceiptDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => AllocateReceiptLineDto)
    allocations!: AllocateReceiptLineDto[]

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class ListReceivablesQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsEnum(ReceivableOpenItemStatus)
    status?: ReceivableOpenItemStatus

    // Boolean('false') === true, nên query string phải parse tay.
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    onlyOpen?: boolean

    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    overdueOnly?: boolean

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

export class PartyDebtQueryDto {
    @IsOptional()
    @IsUUID()
    partyId?: string
}

export class ReceivableAgingQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    /** Report date in YYYY-MM-DD; defaults to today. */
    @IsOptional()
    @IsString()
    asOf?: string
}

export class ReceivableCollectionKpiQueryDto {
    @IsOptional()
    @IsString()
    fromDate?: string

    @IsOptional()
    @IsString()
    toDate?: string
}
