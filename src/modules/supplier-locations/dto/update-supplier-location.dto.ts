import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'

export class UpdateSupplierLocationDto {
    @IsOptional()
    @IsUUID()
    areaId?: string

    @IsOptional()
    @IsArray()
    supplierCustomerIds?: string[]

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    name?: string

    @IsOptional()
    @IsString()
    nameInvoice?: string

    @IsOptional()
    @IsString()
    address?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    warehouseType?: string

    @IsOptional()
    @IsBoolean()
    isOperationalWarehouse?: boolean

    @IsOptional()
    @IsString()
    note?: string
}
