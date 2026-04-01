import { ArrayMinSize, IsArray } from 'class-validator'

export class DeleteMultipleBankTransactionsDto {
    @IsArray()
    @ArrayMinSize(1)
    ids!: string[]
}
