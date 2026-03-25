import { Type } from 'class-transformer'
import { IsDateString, IsIn, IsOptional, IsString, IsUUID } from 'class-validator'
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto'

export class QueryBankTransactionsDto extends PaginationQueryDto {
    @IsOptional()
    @IsUUID()
    bankAccountId?: string

    @IsOptional()
    @IsDateString()
    fromDate?: string

    @IsOptional()
    @IsDateString()
    toDate?: string

    @IsOptional()
    @IsString()
    keyword?: string

    @IsOptional()
    @IsIn(['UNMATCHED', 'AUTO_MATCHED', 'MANUAL_MATCHED', 'PARTIAL_MATCHED'])
    matchStatus?: 'UNMATCHED' | 'AUTO_MATCHED' | 'MANUAL_MATCHED' | 'PARTIAL_MATCHED'

    @IsOptional()
    @IsIn(['IN', 'OUT'])
    direction?: 'IN' | 'OUT'

    @IsOptional()
    @Type(() => String)
    confirmed?: string
}
