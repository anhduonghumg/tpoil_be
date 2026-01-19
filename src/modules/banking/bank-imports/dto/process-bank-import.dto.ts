import { IsOptional, IsString } from 'class-validator'

export class ProcessBankImportDto {
    @IsOptional()
    @IsString()
    note?: string
}
