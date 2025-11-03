// dto/create-customer.dto.ts
import { IsArray, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUppercase, IsNumber, Min, ArrayUnique } from 'class-validator'
import { Type } from 'class-transformer'

export enum CustomerType {
    B2B = 'B2B',
    B2C = 'B2C',
    Distributor = 'Distributor',
    Other = 'Other',
}
export enum CustomerRole {
    Agent = 'Agent',
    Retail = 'Retail',
    Wholesale = 'Wholesale',
    Other = 'Other',
}
export enum CustomerStatus {
    Active = 'Active',
    Inactive = 'Inactive',
    Blacklisted = 'Blacklisted',
}

export class CreateCustomerDto {
    @IsOptional()
    @IsString()
    @IsUppercase()
    code?: string

    @IsString()
    name!: string

    @IsOptional()
    @IsString()
    taxCode?: string

    @IsArray()
    @ArrayUnique()
    @IsEnum(CustomerRole, { each: true })
    roles: CustomerRole[] = []

    @IsEnum(CustomerType)
    type!: CustomerType

    @IsOptional()
    @IsString()
    billingAddress?: string

    @IsOptional()
    @IsString()
    shippingAddress?: string

    @IsOptional()
    @IsEmail()
    contactEmail?: string

    @IsOptional()
    @IsString()
    contactPhone?: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    creditLimit?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number
}
