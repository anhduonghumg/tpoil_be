import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator'
import { AttachmentCategory } from '@prisma/client'

export class CreateContractAttachmentDto {
    @IsUUID()
    contractId: string

    @IsString()
    fileName: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    externalUrl?: string

    @IsEnum(AttachmentCategory)
    category: AttachmentCategory
}
