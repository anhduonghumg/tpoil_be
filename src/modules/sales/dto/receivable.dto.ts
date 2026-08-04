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
