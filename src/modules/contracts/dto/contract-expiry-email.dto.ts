import { IsArray, IsEmail, IsOptional, IsString } from 'class-validator'

export class ContractExpiryEmailDto {
    @IsOptional()
    @IsString()
    referenceDate?: string

    @IsOptional()
    @IsString()
    status?: 'all' | 'expiring' | 'expired'

    @IsArray()
    @IsEmail({}, { each: true })
    to: string[]

    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    cc?: string[]

    @IsOptional()
    @IsEmail()
    replyTo?: string
}
