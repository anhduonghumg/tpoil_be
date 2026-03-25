import { Type } from 'class-transformer'
import { ArrayMinSize, IsArray, IsBoolean, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min, ValidateNested } from 'class-validator'

export class ConfirmBankTransactionAllocationDto {
    @IsUUID()
    settlementId!: string

    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 2 })
    @Min(0.01)
    allocatedAmount!: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    score?: number

    @IsOptional()
    @IsBoolean()
    isAuto?: boolean

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    sortOrder?: number

    @IsOptional()
    @IsString()
    note?: string
}

export class ConfirmBankTransactionDto {
    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ConfirmBankTransactionAllocationDto)
    allocations!: ConfirmBankTransactionAllocationDto[]

    @IsOptional()
    @IsString()
    note?: string
}
