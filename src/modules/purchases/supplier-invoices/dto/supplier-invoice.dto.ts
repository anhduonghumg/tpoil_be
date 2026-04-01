import { ArrayMinSize, IsArray, IsDateString, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class CreateSupplierInvoiceLineDto {
    @IsUUID()
    supplierLocationId!: string

    @IsUUID()
    productId!: string

    @IsNumber()
    qty!: number

    @IsOptional()
    @IsNumber()
    tempC?: number

    @IsOptional()
    @IsNumber()
    density?: number

    @IsOptional()
    @IsNumber()
    standardQtyV15?: number

    @IsOptional()
    @IsNumber()
    unitPrice?: number

    @IsOptional()
    @IsNumber()
    taxRate?: number

    @IsOptional()
    @IsNumber()
    discountAmount?: number

    @IsOptional()
    @IsUUID()
    goodsReceiptId?: string
}

export class CreateSupplierInvoiceDto {
    @IsUUID()
    supplierCustomerId!: string

    @IsOptional()
    @IsUUID()
    purchaseOrderId?: string

    @IsString()
    invoiceNo!: string

    @IsOptional()
    @IsString()
    invoiceSymbol?: string

    @IsOptional()
    @IsString()
    invoiceTemplate?: string

    @IsDateString()
    invoiceDate!: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    sourceFileId?: string

    @IsOptional()
    @IsString()
    sourceFileUrl?: string

    @IsOptional()
    @IsString()
    sourceFileName?: string

    @IsOptional()
    @IsString()
    sourceFileChecksum?: string

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => CreateSupplierInvoiceLineDto)
    lines!: CreateSupplierInvoiceLineDto[]
}

export class PostSupplierInvoiceDto {
    @IsOptional()
    @IsString()
    note?: string
}

export class VoidSupplierInvoiceDto {
    @IsOptional()
    @IsString()
    reason?: string
}
