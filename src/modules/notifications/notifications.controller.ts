import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Sse, UseGuards } from '@nestjs/common'
import type { MessageEvent } from '@nestjs/common'
import type { Request } from 'express'
import { interval, merge, Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { RegisterNotificationDeviceDto } from './dto/notification-device.dto'
import { UpdateNotificationPreferenceDto } from './dto/notification-preference.dto'
import { NotificationEventBus } from './notification-event-bus.service'
import { NotificationsService } from './notifications.service'

@UseGuards(LoggedInGuard)
@Controller('notifications')
export class NotificationsController {
    constructor(
        private readonly service: NotificationsService,
        private readonly eventBus: NotificationEventBus,
    ) {}

    private userId(req: Request) {
        return (req as any).user.id as string
    }

    @Get()
    list(
        @Req() req: Request,
        @Query('unreadOnly') unreadOnly?: string,
        @Query('cursor') cursor?: string,
        @Query('limit') limit?: string,
    ) {
        return this.service.list(this.userId(req), {
            unreadOnly: unreadOnly === 'true',
            cursor,
            limit: limit ? Number(limit) : undefined,
        })
    }

    @Get('unread-count')
    unreadCount(@Req() req: Request) {
        return this.service.unreadCount(this.userId(req))
    }

    @Patch(':id/read')
    markRead(@Req() req: Request, @Param('id') id: string) {
        return this.service.markRead(this.userId(req), id)
    }

    @Patch('read-all')
    markAllRead(@Req() req: Request) {
        return this.service.markAllRead(this.userId(req))
    }

    @Get('preferences')
    preferences(@Req() req: Request) {
        return this.service.preferences(this.userId(req))
    }

    @Patch('preferences')
    updatePreference(@Req() req: Request, @Body() dto: UpdateNotificationPreferenceDto) {
        return this.service.updatePreference(this.userId(req), dto)
    }

    @Post('devices')
    registerDevice(@Req() req: Request, @Body() dto: RegisterNotificationDeviceDto) {
        return this.service.registerDevice(this.userId(req), dto)
    }

    @Delete('devices/:deviceId')
    disableDevice(@Req() req: Request, @Param('deviceId') deviceId: string) {
        return this.service.disableDevice(this.userId(req), deviceId)
    }

    @Sse('stream')
    stream(@Req() req: Request): Observable<MessageEvent> {
        const heartbeat = interval(25_000).pipe(
            map(() => ({ type: 'heartbeat', data: { at: new Date().toISOString() } })),
        )
        return merge(this.eventBus.forUser(this.userId(req)), heartbeat)
    }
}

