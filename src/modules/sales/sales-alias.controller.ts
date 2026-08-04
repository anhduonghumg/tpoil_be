import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesAliasService } from './sales-alias.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CreateAliasDto,
    ImportAliasDto,
    ListAliasQueryDto,
    UpdateAliasDto,
} from './dto/sales-alias.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

/** Master data owned by the business: how customers, depots and products get written. */
@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-aliases')
export class SalesAliasController {
    constructor(private readonly service: SalesAliasService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.aliasManage, PERMISSIONS.sales.view)
    list(@Query() query: ListAliasQueryDto) {
        return this.service.list(query)
    }

    /** Spellings quick entry keeps failing on, most frequent first. */
    @Get('unmatched')
    @RequirePermissions(PERMISSIONS.sales.aliasManage)
    unmatched(@Query('limit') limit?: string) {
        return this.service.unmatched(limit ? Number(limit) : undefined)
    }

    @Post()
    @RequirePermissions(PERMISSIONS.sales.aliasManage)
    create(@Body() dto: CreateAliasDto, @Req() req: Request) {
        return this.service.create(dto, actorFrom(req))
    }

    /** Paste the sheet straight in: name + comma-separated aliases per row. */
    @Post('import')
    @RequirePermissions(PERMISSIONS.sales.aliasManage)
    import(@Body() dto: ImportAliasDto, @Req() req: Request) {
        return this.service.import(dto, actorFrom(req))
    }

    @Patch(':id')
    @RequirePermissions(PERMISSIONS.sales.aliasManage)
    update(@Param('id') id: string, @Body() dto: UpdateAliasDto, @Req() req: Request) {
        return this.service.update(id, dto, actorFrom(req))
    }

    /** Retires the spelling; history is kept rather than deleted. */
    @Delete(':id')
    @RequirePermissions(PERMISSIONS.sales.aliasManage)
    retire(@Param('id') id: string) {
        return this.service.retire(id)
    }
}
