import { Transform, Type } from 'class-transformer'
import {
    ArrayMinSize,
    IsArray,
    IsBoolean,
    IsEnum,
    IsInt,
    IsOptional,
    IsString,
    IsUUID,
    MaxLength,
    Min,
} from 'class-validator'
import { SalesAliasEntityType, SalesAliasSource } from '@prisma/client'

export class ListAliasQueryDto {
    @IsOptional()
    @IsEnum(SalesAliasEntityType)
    entityType?: SalesAliasEntityType

    @IsOptional()
    @IsUUID()
    entityId?: string

    @IsOptional()
    @IsEnum(SalesAliasSource)
    source?: SalesAliasSource

    @IsOptional()
    @IsString()
    keyword?: string

    // Boolean('false') === true, nên query string phải parse tay.
    @IsOptional()
    @Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value))
    @IsBoolean()
    includeRetired?: boolean

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    page?: number

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    limit?: number
}

/** Several spellings for one entity at once — business pastes lists, not single lines. */
export class CreateAliasDto {
    @IsEnum(SalesAliasEntityType)
    entityType!: SalesAliasEntityType

    @IsUUID()
    entityId!: string

    @IsArray()
    @ArrayMinSize(1)
    @IsString({ each: true })
    aliases!: string[]

    @IsOptional()
    @IsEnum(SalesAliasSource)
    source?: SalesAliasSource

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

export class UpdateAliasDto {
    @IsString()
    @MaxLength(255)
    externalName!: string

    @IsOptional()
    @IsString()
    @MaxLength(500)
    note?: string
}

/**
 * The spreadsheet pasted as-is: one row per entity, name and the comma-separated alias list
 * separated by a tab (Excel paste) or a comma (CSV export).
 */
export class ImportAliasDto {
    @IsEnum(SalesAliasEntityType)
    entityType!: SalesAliasEntityType

    @IsString()
    text!: string
}
