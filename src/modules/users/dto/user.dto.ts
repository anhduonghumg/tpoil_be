import { IsArray, IsBoolean, IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator'

export class CreateUserDto {
    @IsString()
    username!: string

    @IsEmail()
    email!: string

    @IsOptional()
    @IsString()
    name?: string | null

    @IsBoolean()
    isActive!: boolean

    @IsString()
    @MinLength(6)
    password!: string

    @IsOptional()
    @IsUUID()
    employeeId?: string | null

    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    roleIds?: string[]
}

export class UpdateUserDto {
    @IsOptional()
    @IsEmail()
    email?: string

    @IsOptional()
    @IsString()
    name?: string | null

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsUUID()
    employeeId?: string | null

    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    roleIds?: string[]
}

export class SetUserRolesDto {
    @IsOptional()
    @IsArray()
    @IsUUID(undefined, { each: true })
    roleIds?: string[]
}

export class SetUserEmployeeDto {
    @IsOptional()
    @IsUUID(undefined, { each: true })
    employeeId!: string | null
}

export class ResetPasswordDto {
    @IsString()
    @MinLength(6)
    password!: string
}
