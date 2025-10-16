// src/employees/dto/address.dto.ts
import { IsOptional, IsString } from 'class-validator'

export class AddressDto {
    @IsOptional() @IsString() province?: string
    @IsOptional() @IsString() district?: string
    @IsOptional() @IsString() ward?: string
    @IsOptional() @IsString() street?: string
}
