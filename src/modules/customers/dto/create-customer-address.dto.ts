import { Type } from 'class-transformer'
import { IsDate, IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateCustomerAddressDto {
    @IsString()
    @MaxLength(500)
    addressLine!: string

    @Type(() => Date)
    @IsDate()
    validFrom!: Date

    @IsOptional()
    @IsString()
    note?: string
}
