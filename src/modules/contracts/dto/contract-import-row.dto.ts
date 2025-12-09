// src/modules/contracts/dto/contract-import-row.dto.ts
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'

export class ContractImportRowDto {
    @IsNotEmpty()
    @IsString()
    code: string

    @IsNotEmpty()
    @IsString()
    name: string

    // Mã KH (Customer.code)
    @IsNotEmpty()
    @IsString()
    customerCode: string

    // Mã loại HĐ (ContractType.code)
    @IsNotEmpty()
    @IsString()
    contractTypeCode: string

    // Cho phép DD/MM/YYYY hoặc YYYY-MM-DD
    @IsNotEmpty()
    @IsString()
    startDate: string

    @IsNotEmpty()
    @IsString()
    endDate: string

    @IsIn(['Draft', 'Pending', 'Active', 'Terminated', 'Cancelled'])
    status: 'Draft' | 'Pending' | 'Active' | 'Terminated' | 'Cancelled'

    @IsOptional()
    paymentTermDays?: number | null

    @IsOptional()
    creditLimitOverride?: number | null

    @IsIn(['Low', 'Medium', 'High'])
    riskLevel: 'Low' | 'Medium' | 'High'

    @IsOptional()
    @IsString()
    sla?: string | null

    @IsOptional()
    @IsString()
    deliveryScope?: string | null

    // Mã HĐ gốc (Contract.code) để gia hạn
    @IsOptional()
    @IsString()
    renewalOfCode?: string | null
}
