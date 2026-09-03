import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { SalesInvoicesService } from './sales-invoices.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CancelSalesInvoiceDto,
    InvoiceSourceDto,
    IssueSalesInvoiceDto,
    ListSalesInvoicesQueryDto,
    ListUnissuedSalesInvoicesQueryDto,
    ActivateInvoiceEnvironmentDto,
    UpdateInvoiceProviderConfigDto,
} from './dto/sales-invoice.dto'

function actorFrom(req: Request): ScopedActor {
    const auth = (req.session as any)?.auth
    return {
        userId: auth?.userId ?? (req as any).user?.id ?? null,
        permissions: auth?.permissions ?? [],
        scopes: auth?.scopes ?? [],
    }
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('sales-invoices')
export class SalesInvoicesController {
    constructor(private readonly service: SalesInvoicesService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    list(@Query() query: ListSalesInvoicesQueryDto) {
        return this.service.list(query)
    }

    @Get('unissued')
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    unissued(@Query() query: ListUnissuedSalesInvoicesQueryDto) {
        return this.service.listUnissued(query)
    }

    /** What the invoice would contain — reads what actually shipped, writes nothing. */
    @Post('preview')
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    preview(@Body() dto: InvoiceSourceDto) {
        return this.service.preview(dto)
    }

    /** Cấu hình MISA đang chạy. Phải khai TRƯỚC ':id', không thì bị nuốt thành một id. */
    @Get('settings')
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    settings() {
        return this.service.misaSettings()
    }

    /** Đổi cấu hình là đổi nơi hóa đơn bay tới, nên đòi quyền phát hành. */
    @Put('settings')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    updateSettings(@Body() dto: UpdateInvoiceProviderConfigDto, @Req() req: Request) {
        return this.service.updateMisaSettings(dto, actorFrom(req))
    }

    /** Chuyển môi trường đang dùng — tách riêng khỏi lưu, vì đây mới là hành động rủi ro. */
    @Put('settings/active')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    activateSettings(@Body() dto: ActivateInvoiceEnvironmentDto) {
        return this.service.activateMisaEnvironment(dto.environment)
    }

    /** Link xem bản PDF trên meInvoice — chỉ hóa đơn đã phát hành. */
    @Get(':id/document')
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    document(@Param('id') id: string) {
        return this.service.documentUrl(id)
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.sales.invoiceView, PERMISSIONS.sales.invoiceIssue)
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    /** Creates the draft (and its number) before any call to MISA. */
    @Post('drafts')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    createDraft(@Body() dto: InvoiceSourceDto, @Req() req: Request) {
        return this.service.createDraft(dto, actorFrom(req))
    }

    @Post(':id/issue')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    issue(@Param('id') id: string, @Body() dto: IssueSalesInvoiceDto, @Req() req: Request) {
        return this.service.issue(id, actorFrom(req), dto)
    }

    /** Retry is the same call: it queries MISA first, so it can never double-publish. */
    @Post(':id/retry')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    retry(@Param('id') id: string, @Body() dto: IssueSalesInvoiceDto, @Req() req: Request) {
        return this.service.issue(id, actorFrom(req), dto)
    }

    @Post(':id/cancel')
    @RequirePermissions(PERMISSIONS.sales.invoiceIssue)
    cancel(@Param('id') id: string, @Body() dto: CancelSalesInvoiceDto, @Req() req: Request) {
        return this.service.cancel(id, dto, actorFrom(req))
    }
}
