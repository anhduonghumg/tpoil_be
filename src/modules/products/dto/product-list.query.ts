import { IsOptional, IsString } from 'class-validator'

export class ProductListQuery {
    @IsOptional()
    @IsString()
    keyword?: string
}
