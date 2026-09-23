import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator'

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

export class UpsertDepositInterestRateDto {
    @Matches(DATE_ONLY, { message: 'effectiveFrom phải có dạng YYYY-MM-DD' })
    effectiveFrom!: string

    /** %/năm, vd. 5.5 là 5,5%/năm. */
    @Type(() => Number)
    @IsNumber({ maxDecimalPlaces: 4 })
    @Min(0)
    @Max(100)
    annualRate!: number

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class ReceivableInterestReportQueryDto {
    @IsOptional()
    @IsUUID()
    customerPartyId?: string

    @IsOptional()
    @Matches(DATE_ONLY)
    fromDate?: string

    @IsOptional()
    @Matches(DATE_ONLY)
    toDate?: string
}
