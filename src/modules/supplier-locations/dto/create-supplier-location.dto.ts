import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateSupplierLocationDto {
    @IsUUID()
    areaId!: string

    @IsString()
    @IsNotEmpty()
    code!: string

    @IsString()
    @IsNotEmpty()
    name!: string

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

    @IsOptional()
    @IsArray()
    supplierCustomerIds?: string[]
}
