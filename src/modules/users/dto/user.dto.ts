import { IsBoolean, IsEmail, IsOptional, IsString, MinLength } from 'class-validator'

export class CreateUserDto {
    @IsString() username!: string

    @IsEmail() email!: string

    @IsString()
    @MinLength(6)
    password!: string

    @IsOptional()
    @IsString()
    name?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean
}

export class UpdateUserDto {
    @IsEmail()
    email!: string

    @IsOptional()
    @IsString()
    name?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsString()
    @MinLength(6)
    password?: string
}

export class SetUserRolesDto {
    roleIds!: string[]
}

export class SetUserEmployeeDto {
    employeeId!: string | null
}
