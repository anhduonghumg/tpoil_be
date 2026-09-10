import { IsString, IsUUID, IsOptional, IsEnum, IsInt, IsDateString, IsArray } from 'class-validator'
import { ContractKind, ContractStatus, RiskLevel } from '@prisma/client'

export class CreateContractDto {
    @IsString()
    name: string

    @IsString()
    code: string

    @IsOptional()
    @IsUUID()
    customerId?: string

    @IsUUID()
    contractTypeId: string

    @IsDateString()
    startDate: string

    @IsDateString()
    endDate: string

    @IsEnum(ContractStatus)
    status: ContractStatus

    @IsOptional()
    @IsInt()
    paymentTermDays?: number

    @IsOptional()
    creditLimitOverride?: number

    @IsOptional()
    sla?: any

    @IsOptional()
    deliveryScope?: any

    @IsEnum(RiskLevel)
    riskLevel: RiskLevel

    @IsOptional()
    @IsUUID()
    renewalOfId?: string

    @IsOptional()
    @IsString()
    approvalRequestId?: string

    /**
     * @deprecated Không còn được dùng. Chiều giao dịch do loại thương nhân của đối tác
     * quyết định (TNPP mua và bán, TNDM chỉ mua của họ, TNDL chỉ bán cho họ), nên server
     * tự suy ra `kind`. Vẫn nhận để client cũ không vỡ, nhưng giá trị gửi lên bị bỏ qua.
     */
    @IsOptional()
    @IsEnum(ContractKind)
    kind?: ContractKind

    @IsOptional()
    @IsArray()
    @IsUUID('all', { each: true })
    warehouseIds?: string[]
}
