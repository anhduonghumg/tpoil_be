import { Type } from 'class-transformer'
import { IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator'
import { SalesInvoiceStatus } from '@prisma/client'

/** Exactly one source: a SINGLE order as a whole, or one LOT draw. */
export class InvoiceSourceDto {
    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    @IsOptional()
    @IsUUID()
    withdrawalRequestId?: string
}

export class ListSalesInvoicesQueryDto {
    @IsOptional()
    @IsEnum(SalesInvoiceStatus)
    status?: SalesInvoiceStatus

    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    accountantEmployeeId?: string

    @IsOptional()
    @IsUUID()
    salesOrderId?: string

    /** Hóa đơn của một lần rút lô có salesOrderId = null, phải lọc bằng chính phiếu rút. */
    @IsOptional()
    @IsUUID()
    withdrawalRequestId?: string

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

/** Sources that have reached the invoicing stage but do not yet have a live original invoice. */
export class ListUnissuedSalesInvoicesQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @IsUUID()
    accountantEmployeeId?: string

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

export class CancelSalesInvoiceDto {
    @IsString()
    @MaxLength(1000)
    reason!: string
}
