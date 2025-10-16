// src/employees/dto/create-employee.dto.ts
import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, IsArray } from 'class-validator'
import { Type } from 'class-transformer'
import { DMYtoDate } from './date.transform'
import { AddressDto } from './address.dto'
import { CitizenDto } from './citizen.dto'
import { TaxDto, BankingDto } from './finance.dto'

export class CreateEmployeeDto {
    // personal
    @IsString() name!: string
    @IsOptional() @IsEnum(['male', 'female', 'other']) gender?: 'male' | 'female' | 'other'
    @IsOptional() @DMYtoDate() dob?: Date
    @IsOptional() @IsString() nationality?: string
    @IsOptional() @IsString() maritalStatus?: string
    @IsOptional() @IsString() avatarUrl?: string

    // contact
    @IsOptional() @IsEmail() workEmail?: string
    @IsOptional() @IsEmail() personalEmail?: string
    @IsOptional() @IsString() phone?: string

    @IsOptional() @Type(() => AddressDto) addressPermanent?: AddressDto
    @IsOptional() @Type(() => AddressDto) addressTemp?: AddressDto

    @IsOptional() emergency?: { name?: string; relation?: string; phone?: string }

    // citizen / json
    @IsOptional() @Type(() => CitizenDto) citizen?: CitizenDto

    // employment
    @IsOptional() @IsEnum(['active', 'inactive', 'on_leave']) status?: 'active' | 'inactive' | 'on_leave'
    @IsOptional() @DMYtoDate() joinedAt?: Date
    @IsOptional() @DMYtoDate() leftAt?: Date

    @IsOptional() @IsString() code?: string

    // department: 1 hoặc nhiều
    @IsOptional() @IsString() departmentId?: string
    @IsOptional() @IsString() departmentName?: string
    @IsOptional() @IsArray() departmentIds?: string[]

    // manager/site/seat
    @IsOptional() @IsUUID() managerId?: string
    @IsOptional() @IsString() managerName?: string

    @IsOptional() @IsUUID() siteId?: string
    @IsOptional() @IsString() floor?: string
    @IsOptional() @IsString() area?: string
    @IsOptional() @IsString() desk?: string

    @IsOptional() @IsString() title?: string
    @IsOptional() @IsString() grade?: string

    @IsOptional() @IsString() accessCardId?: string

    // finance json
    @IsOptional() @Type(() => TaxDto) tax?: TaxDto
    @IsOptional() @Type(() => BankingDto) banking?: BankingDto
}
