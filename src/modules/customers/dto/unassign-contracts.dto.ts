import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator'

export class UnassignContractsDto {
    @IsArray()
    @ArrayNotEmpty()
    @IsUUID('all', { each: true })
    contractIds: string[]
}
