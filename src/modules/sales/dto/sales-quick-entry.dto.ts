import { Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsDateString,
    IsIn,
    IsNumber,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
    ValidateNested,
} from 'class-validator'

export class ParseQuickEntryDto {
    @IsString()
    @MaxLength(5000)
    text!: string
}

export class ConfirmQuickEntryLineDto {
    @IsUUID()
    productId!: string

    @IsUUID()
    warehouseId!: string

    @Type(() => Number)
    @IsNumber()
    @Min(0.000001)
    quantity!: number

    @IsOptional()
    @Type(() => Number)
    @IsNumber()
    @Min(0)
    unitPrice?: number

    /** What was pasted, so a manual correction can be remembered as an alias. */
    @IsOptional()
    @IsString()
    productRawText?: string

    @IsOptional()
    @IsString()
    warehouseRawText?: string
}

export class ConfirmQuickEntryDto {
    @IsOptional()
    @IsUUID()
    logId?: string

    @IsIn(['SINGLE', 'LOT', 'WITHDRAWAL'])
    orderKind!: 'SINGLE' | 'LOT' | 'WITHDRAWAL'

    @IsUUID()
    customerPartyId!: string

    @IsOptional()
    @IsDateString()
    orderDate?: string

    @IsOptional()
    @IsString()
    @MaxLength(30)
    vehiclePlate?: string

    @IsOptional()
    @IsString()
    @MaxLength(255)
    driverName?: string

    @IsOptional()
    @IsString()
    customerRawText?: string

    /** Off by default only if the sale explicitly asks not to remember the spelling. */
    @IsOptional()
    @Type(() => Boolean)
    @IsBoolean()
    learnAliases?: boolean

    @IsArray()
    @ArrayMinSize(1)
    @ValidateNested({ each: true })
    @Type(() => ConfirmQuickEntryLineDto)
    lines!: ConfirmQuickEntryLineDto[]
}
