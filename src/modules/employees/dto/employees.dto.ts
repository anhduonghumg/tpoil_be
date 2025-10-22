import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, IsBoolean, IsInt, Min } from 'class-validator'
import { Type } from 'class-transformer'
import { EmployeeStatus, Gender } from '@prisma/client'

export class EmployeeListQueryDto {
    @IsOptional() @IsString() q?: string
    @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus
    @IsOptional() @IsUUID() departmentId?: string
    @IsOptional() @IsUUID() siteId?: string
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
    @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize = 20
    @IsOptional() @IsString() sortBy: 'createdAt' | 'updatedAt' | 'code' | 'fullName' = 'updatedAt'
    @IsOptional() @IsString() sortDir: 'asc' | 'desc' = 'desc'
}

export class EmployeeCreateDto {
    @IsString() code!: string
    @IsOptional() @IsString() fullName?: string
    @IsOptional() @IsEnum(Gender) gender?: Gender
    @IsOptional() dob?: string
    @IsOptional() joinedAt?: string
    @IsOptional() leftAt?: string

    @IsOptional() @IsString() phone?: string
    @IsOptional() @IsEmail() personalEmail?: string

    @IsOptional() @IsEnum(EmployeeStatus) status?: EmployeeStatus
    @IsOptional() @IsString() title?: string
    @IsOptional() @IsString() grade?: string
    @IsOptional() @Type(() => Number) @IsInt() @Min(0) floor?: number
    @IsOptional() @IsString() desk?: string

    @IsOptional() @IsUUID() siteId?: string
    @IsOptional() @IsUUID() managerId?: string
    @IsOptional() @IsString() departmentId?: string

    @IsOptional() @IsString() avatarUrl?: string
    @IsOptional() @IsString() accessCardId?: string

    @IsOptional() banking?: any
    @IsOptional() citizen?: any
    @IsOptional() emergency?: any
    @IsOptional() tax?: any

    @IsOptional() @IsUUID() primaryDepartmentId?: string
}

export class EmployeeUpdateDto extends EmployeeCreateDto {}

export class SetMembershipDto {
    @IsUUID() employeeId!: string
    @IsUUID() departmentId!: string
    @IsOptional() @IsBoolean() isPrimary?: boolean
    @IsOptional() startDate?: string
    @IsOptional() endDate?: string
}
