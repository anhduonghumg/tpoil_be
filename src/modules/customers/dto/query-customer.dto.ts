// dto/query-customer.dto.ts
import { IsEnum, IsNumberString, IsOptional, IsString } from 'class-validator'
import { CustomerStatus } from './create-customer.dto'

export class QueryCustomerDto {
    @IsOptional() @IsString() keyword?: string
    @IsOptional() @IsEnum(CustomerStatus) status?: CustomerStatus
    @IsOptional() @IsString() role?: string
    @IsOptional() @IsNumberString() page?: string
    @IsOptional() @IsNumberString() pageSize?: string
    @IsOptional() enrich?: string
}
