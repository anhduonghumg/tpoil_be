// src/modules/contracts/dto/import-contracts.dto.ts
import { Type } from 'class-transformer'
import { ValidateNested, ArrayMinSize } from 'class-validator'
import { ContractImportRowDto } from './contract-import-row.dto'

export class ImportContractsDto {
    @ValidateNested({ each: true })
    @Type(() => ContractImportRowDto)
    @ArrayMinSize(1)
    rows: ContractImportRowDto[]
}

// Kết quả trả về cho FE
export interface ImportContractsResultItem {
    index: number
    code: string
    success: boolean
    error?: string
}

export interface ImportContractsResult {
    total: number
    successCount: number
    failureCount: number
    items: ImportContractsResultItem[]
}
