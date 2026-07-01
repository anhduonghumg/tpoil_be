import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator'

export class PrintTermOrderDocumentsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @IsUUID('all', { each: true })
    ids!: string[]

    @IsOptional()
    @IsBoolean()
    autoGenerate?: boolean
}
