import { Type } from 'class-transformer'
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator'

export class UpdateReconciliationLineDto {
    /** Quantity printed on the warehouse issue document. */
    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    docQty?: number

    @IsOptional()
    @IsString()
    @MaxLength(2000)
    varianceNote?: string
}

export class ResolveReconciliationLineDto {
    @IsString()
    @MaxLength(2000)
    varianceNote!: string

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    docQty?: number
}
