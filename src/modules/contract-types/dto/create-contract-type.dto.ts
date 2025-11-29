import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator'

export class CreateContractTypeDto {
    @IsString()
    code!: string

    @IsString()
    name!: string

    @IsOptional()
    @IsString()
    description?: string

    @IsOptional()
    @IsBoolean()
    isActive?: boolean

    @IsOptional()
    @IsInt()
    @Min(0)
    sortOrder?: number
}
