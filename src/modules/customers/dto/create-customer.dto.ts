import { Type } from 'class-transformer'
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { CustomerRole, CustomerStatus, CustomerType, TaxSource } from '@prisma/client'

export class CreateCustomerDto {
    @IsOptional()
    @IsString()
    @MaxLength(50)
    code?: string

    @IsString()
    @MaxLength(255)
    name!: string

    @IsOptional()
    @IsString()
    @MaxLength(50)
    taxCode?: string

    @IsOptional()
    @IsBoolean()
    taxVerified?: boolean

    @IsOptional()
    @IsEnum(TaxSource)
    taxSource?: TaxSource

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    taxSyncedAt?: Date

    @IsArray()
    @IsEnum(CustomerRole, { each: true })
    roles!: CustomerRole[]

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
    @IsNumber()
    tempLimit?: number

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    tempFrom?: Date

    @IsOptional()
    @Type(() => Date)
    @IsDate()
    tempTo?: Date

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(0)
    paymentTermDays?: number

    @IsOptional()
    @IsEnum(CustomerStatus)
    status?: CustomerStatus

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsString()
    salesOwnerEmpId?: string

    @IsOptional()
    @IsString()
    accountingOwnerEmpId?: string

    @IsOptional()
    @IsString()
    legalOwnerEmpId?: string
}
