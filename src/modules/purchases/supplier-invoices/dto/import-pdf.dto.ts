import { IsUUID } from 'class-validator'

export class SupplierInvoiceImportPdfDto {
    @IsUUID()
    supplierCustomerId: string
}
