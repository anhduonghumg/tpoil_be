import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator'

export class CreateEnvironmentTaxDto {
    @IsUUID()
    productId!: string

    @IsDateString()
    effectiveFrom!: string

    @IsOptional()
    @IsDateString()
    effectiveTo?: string

    @IsNumber()
    @Min(0)
    taxVndPerLiter!: number

    @IsOptional()
    @IsString()
    status?: string

    @IsOptional()
    @IsString()
    note?: string
}
