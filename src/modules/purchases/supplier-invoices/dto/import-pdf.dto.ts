import { IsOptional, IsUUID } from 'class-validator'

export class SupplierInvoiceImportPdfDto {
    @IsUUID()
    supplierCustomerId: string

    @IsOptional()
    @IsUUID()
    purchaseOrderId?: string
}
