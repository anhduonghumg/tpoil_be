import { IsArray, ArrayNotEmpty, IsString } from 'class-validator'

export class AssignContractsToCustomerDto {
    @IsArray()
    @ArrayNotEmpty({ message: 'Danh sách hợp đồng không được trống' })
    @IsString({ each: true })
    contractIds!: string[]
}
