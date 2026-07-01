import { TermPaymentBatchFileType, TermPaymentBatchItemStatus, TermPaymentBatchStatus } from '@prisma/client'
import { IsArray, IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

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
    @IsNumber()
    page?: number

    @IsOptional()
    @IsNumber()
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
