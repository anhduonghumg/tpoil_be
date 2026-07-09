import { TermPaymentBatchFileType, TermPaymentBatchItemStatus, TermPaymentBatchStatus } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class QueryTermPaymentBatchesDto {
    @IsOptional()
    @IsEnum(TermPaymentBatchStatus)
    status?: TermPaymentBatchStatus

    @IsOptional()
    @IsUUID()
    bankAccountId?: string

    @IsOptional()
    @IsString()
    keyword?: string

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
}

export class CreateTermPaymentBatchDto {
    @IsArray()
    @IsUUID(undefined, { each: true })
    paymentRequestIds!: string[]

    @IsOptional()
    @IsUUID()
    bankAccountId?: string

    @IsOptional()
    @IsDateString()
    batchDate?: string

    @IsOptional()
    @IsString()
    note?: string
}

export class UploadTermPaymentBatchFileDto {
    @IsOptional()
    @IsEnum(TermPaymentBatchFileType)
    fileType?: TermPaymentBatchFileType

    @IsOptional()
    @IsString()
    note?: string
}

export class MatchTermPaymentBatchItemDto {
    @IsUUID()
    bankTransactionId!: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    paidAmountVnd?: number

    @IsOptional()
    @IsEnum(TermPaymentBatchItemStatus)
    status?: TermPaymentBatchItemStatus

    @IsOptional()
    @IsString()
    note?: string
}
