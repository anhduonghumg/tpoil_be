import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString, ArrayMinSize } from 'class-validator'

export class CreateSupplierLocationDto {
    @IsString()
    @IsNotEmpty()
    code!: string

    @IsString()
    @IsNotEmpty()
    name!: string

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

    @IsArray()
    @ArrayMinSize(1)
    supplierCustomerIds!: string[]
}
