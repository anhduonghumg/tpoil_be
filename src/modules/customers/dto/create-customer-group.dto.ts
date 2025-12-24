import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CreateCustomerGroupDto {
    @IsString()
    @MaxLength(50)
    code!: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    name?: string

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}
