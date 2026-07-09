import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, ValidateNested } from 'class-validator'
import { Type } from 'class-transformer'

export class GenerateTermOrderDocumentDto {
    @IsOptional()
    @IsIn(['FACTORY', 'WAREHOUSE'])
    deliveryMode?: 'FACTORY' | 'WAREHOUSE'

    @IsOptional()
    @IsIn(['BINH_SON', 'NGHI_SON', 'IMPORT'])
    originSource?: 'BINH_SON' | 'NGHI_SON' | 'IMPORT'

    @IsOptional()
    @IsString()
    paymentMethodText?: string
}

export class PrintTermOrderDocumentsDto {
    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(100)
    @IsUUID('all', { each: true })
    ids!: string[]

    @IsOptional()
    @IsBoolean()
    autoGenerate?: boolean

    @IsOptional()
    @ValidateNested()
    @Type(() => GenerateTermOrderDocumentDto)
    documentOptions?: GenerateTermOrderDocumentDto
}
