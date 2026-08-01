import { NotificationDevicePlatform, NotificationPushProvider } from '@prisma/client'
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

export class RegisterNotificationDeviceDto {
    @IsString()
    @MaxLength(160)
    deviceId!: string

    @IsEnum(NotificationDevicePlatform)
    platform!: NotificationDevicePlatform

    @IsOptional()
    @IsEnum(NotificationPushProvider)
    pushProvider?: NotificationPushProvider

    @IsOptional()
    @IsString()
    @MaxLength(1024)
    pushToken?: string

    @IsOptional()
    @IsString()
    @MaxLength(50)
    appVersion?: string

    @IsOptional()
    @IsString()
    @MaxLength(20)
    locale?: string
}

