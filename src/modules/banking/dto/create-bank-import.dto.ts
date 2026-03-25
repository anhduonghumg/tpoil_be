import { IsOptional, IsUUID } from 'class-validator'

export class CreateBankImportDto {
    @IsUUID()
    bankAccountId!: string

    @IsOptional()
    @IsUUID()
    templateId?: string
}
