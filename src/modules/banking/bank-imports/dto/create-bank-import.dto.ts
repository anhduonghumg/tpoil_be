import { IsOptional, IsString, IsUUID } from 'class-validator'

export class CreateBankImportDto {
    @IsUUID()
    bankAccountId!: string

    @IsOptional()
    @IsUUID()
    templateId?: string

    @IsString()
    fileUrl!: string

    @IsOptional()
    @IsString()
    fileChecksum?: string
}
