import { IsEnum, IsOptional, IsString } from 'class-validator'
import { AttachmentCategory } from '@prisma/client'

export class UpdateContractAttachmentDto {
    @IsOptional()
    @IsString()
    fileName?: string

    @IsOptional()
    @IsString()
    fileUrl?: string

    @IsOptional()
    @IsString()
    externalUrl?: string

    @IsOptional()
    @IsEnum(AttachmentCategory)
    category?: AttachmentCategory
}
