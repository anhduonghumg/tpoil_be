import { IsBoolean, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator'

export class UpdateNotificationPreferenceDto {
    @IsString()
    @MaxLength(100)
    category!: string

    @IsOptional()
    @IsBoolean()
    inAppEnabled?: boolean

    @IsOptional()
    @IsBoolean()
    pushEnabled?: boolean

    @IsOptional()
    @IsBoolean()
    emailEnabled?: boolean

    @IsOptional()
    @IsISO8601()
    muteUntil?: string | null
}

