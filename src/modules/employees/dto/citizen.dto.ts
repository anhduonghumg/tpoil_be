// src/employees/dto/citizen.dto.ts
import { IsOptional, IsString } from 'class-validator'
import { DMYtoDate } from './date.transform'

export class CitizenDto {
    @IsOptional() @IsString() type?: string
    @IsOptional() @IsString() number?: string

    @IsOptional() @DMYtoDate() issuedDate?: Date
    @IsOptional() @IsString() issuedPlace?: string
    @IsOptional() @DMYtoDate() expiryDate?: Date

    @IsOptional() @IsString() frontImageUrl?: string
    @IsOptional() @IsString() backImageUrl?: string
}
