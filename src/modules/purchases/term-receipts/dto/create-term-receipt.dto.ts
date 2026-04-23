import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateTermReceiptDto {
    @IsDateString()
    receiptDate!: string

    @IsNumber()
    @Min(0)
    actualQty!: number

    @IsOptional()
    @IsNumber()
    standardQtyV15?: number

    @IsOptional()
    @IsNumber()
    temperature?: number

    @IsOptional()
    @IsNumber()
    density?: number

    @IsOptional()
    @IsUUID()
    supplierLocationId?: string

    @IsOptional()
    @IsString()
    documentNo?: string

    @IsOptional()
    @IsDateString()
    documentDate?: string

    @IsOptional()
    @IsString()
    note?: string
}
