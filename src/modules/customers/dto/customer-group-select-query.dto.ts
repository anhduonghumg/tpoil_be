import { IsOptional, IsString } from 'class-validator'

export class CustomerGroupSelectQueryDto {
    @IsOptional()
    @IsString()
    keyword?: string
}
