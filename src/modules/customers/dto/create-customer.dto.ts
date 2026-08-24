import { Transform, Type } from 'class-transformer'
import { IsArray, IsBoolean, IsDate, IsEmail, IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'
import { CustomerRole, CustomerStatus, CustomerType, OperationalPartyRole, PartyRoleType, PartyType, TaxSource } from '@prisma/client'

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

    // Backward compatible with clients that submit a single selected role.
    // The database and service layer always receive an array.
    @Transform(({ value }) => (value == null || Array.isArray(value) ? value : [value]))
    @IsOptional()
    @IsArray()
    @IsEnum(CustomerRole, { each: true })
    roles?: CustomerRole[]

    @IsOptional()
    @IsArray()
    @IsEnum(OperationalPartyRole, { each: true })
    partnerRoles?: OperationalPartyRole[]

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
    @IsString()
    @MaxLength(100)
    bankAccountNo?: string

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

    @IsOptional()
    @IsEnum(PartyType)
    partyType?: PartyType

    /**
     * Loại thương nhân xăng dầu. Khi có, hệ thống tự sinh CUSTOMER/SUPPLIER tương ứng
     * nên không cần tick tay isCustomer/isSupplier nữa.
     */
    @IsOptional()
    @IsIn([PartyRoleType.TNPP, PartyRoleType.TNDM, PartyRoleType.TNDL] as string[])
    merchantRole?: 'TNPP' | 'TNDM' | 'TNDL' | null

    @IsOptional()
    @IsBoolean()
    isCustomer?: boolean

    @IsOptional()
    @IsBoolean()
    isSupplier?: boolean

    @IsOptional()
    @IsBoolean()
    isInternal?: boolean

    @IsOptional()
    @IsString()
    groupId?: string | null

    @IsOptional()
    @IsString()
    documentOwnerEmpId?: string | null
}
