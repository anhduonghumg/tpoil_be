import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesQuickEntryService } from './sales-quick-entry.service'
import { ScopedActor } from '../sales-warehouse-scope.service'
import { ConfirmQuickEntryDto, ParseQuickEntryDto } from '../dto/sales-quick-entry.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-quick-entry')
export class SalesQuickEntryController {
    constructor(private readonly service: SalesQuickEntryService) {}

    /** Reads the paste and proposes a draft — nothing is created yet. */
    @Post('parse')
    @RequirePermissions(PERMISSIONS.sales.quickEntryUse, PERMISSIONS.sales.create)
    parse(@Body() dto: ParseQuickEntryDto, @Req() req: Request) {
        return this.service.parse(dto, actorFrom(req))
    }

    /** Creates the draft from what the sale confirmed, and remembers their corrections. */
    @Post('confirm')
    @RequirePermissions(PERMISSIONS.sales.quickEntryUse, PERMISSIONS.sales.create)
    confirm(@Body() dto: ConfirmQuickEntryDto, @Req() req: Request) {
        return this.service.confirm(dto, actorFrom(req))
    }
}
