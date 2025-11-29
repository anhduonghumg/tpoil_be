import { IsArray, ArrayNotEmpty, IsString } from 'class-validator'

export class AssignContractsToCustomerDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsString({ each: true })
    contractIds!: string[]
}
