import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class UpdateSupplierLocationDto {
    @IsOptional()
    @IsArray()
    supplierCustomerIds?: string[]

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string

    @IsString()
    nameInvoice?: string

    @IsOptional()
    @IsString()
    address?: string

    @IsOptional()
    @IsString()
    tankCode?: string

    @IsOptional()
    @IsString()
    tankName?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}
