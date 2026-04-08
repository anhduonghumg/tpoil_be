import { IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateCustomerPurchaseDefaultsDto {
    @IsOptional()
    @IsString()
    @MaxLength(100)
    defaultPurchaseContractNo?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    defaultDeliveryLocation?: string
}
