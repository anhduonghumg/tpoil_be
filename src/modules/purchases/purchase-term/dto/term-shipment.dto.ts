import { TermShipmentStatus, TermTransportMode } from '@prisma/client'
import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator'
import { PartialType } from '@nestjs/mapped-types'

export class CreateTermShipmentDto {
    @IsOptional()
    @IsEnum(TermTransportMode)
    transportMode?: TermTransportMode

    @IsOptional()
    @IsString()
    vesselName?: string

    @IsOptional()
    @IsString()
    voyageNo?: string

    @IsOptional()
    @IsString()
    blNo?: string

    @IsOptional()
    @IsString()
    loadingPort?: string

    @IsOptional()
    @IsString()
    dischargePort?: string

    @IsOptional()
    @IsDateString()
    etd?: string

    @IsOptional()
    @IsDateString()
    eta?: string

    @IsOptional()
    @IsString()
    surveyorName?: string

    @IsOptional()
    @IsString()
    note?: string

    @IsOptional()
    @IsEnum(TermShipmentStatus)
    status?: TermShipmentStatus
}

export class UpdateTermShipmentDto extends PartialType(CreateTermShipmentDto) {}
