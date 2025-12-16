// src/modules/auth/dto/login.dto.ts
import { IsString, MinLength } from 'class-validator'
export class LoginDto {
    // @IsEmail() email!: string
    // username?: string
    @IsString()
    identifier!: string

    @MinLength(4)
    password!: string
}
