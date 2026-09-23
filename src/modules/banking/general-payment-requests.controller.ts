import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import {
    CreateGeneralPaymentRequestDto,
    GeneralPaymentRequestDecisionDto,
    RecordGeneralPaymentDto,
    MatchGeneralPaymentReconciliationDto,
    ReverseGeneralPaymentReconciliationDto,
} from './general-payment-request.dto'
import { GeneralPaymentRequestsService } from './general-payment-requests.service'

@UseGuards(LoggedInGuard)
@Controller('banking/general-payment-requests')
export class GeneralPaymentRequestsController {
    constructor(private readonly service: GeneralPaymentRequestsService) {}

    private canApprove(actor: any) {
        const permissions = actor?.permissions ?? []
        const roles = (actor?.roles ?? []).map((role: any) => typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`).join(' ')
        return /director|giám đốc|giam doc|system-admin|admin|quản trị|quan tri/i.test(roles)
            || permissions.includes('system.rbac.admin')
            || permissions.includes('purchases.payment_requests.approve')
    }

    private canManageBankPayment(actor: any) {
        const permissions = actor?.permissions ?? []
        const roles = (actor?.roles ?? []).map((role: any) => typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`).join(' ')
        return /bank|ngân hàng|ngan hang|system-admin|admin|quản trị|quan tri/i.test(roles)
            || permissions.includes('system.rbac.admin')
            || permissions.some((code: string) => code.startsWith('banking.'))
    }

    @Get()
    list() {
        return this.service.list()
    }

    @Post()
    create(@Body() dto: CreateGeneralPaymentRequestDto, @Req() req: Request) {
        return this.service.create(dto, (req as any).user?.id)
    }

    @Post(':id/approve')
    approve(@Param('id') id: string, @Body() dto: GeneralPaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canApprove((req as any).session?.auth)) throw new ForbiddenException('PAYMENT_REQUEST_APPROVAL_FORBIDDEN')
        return this.service.decide(id, true, dto.note, (req as any).user?.id)
    }

    @Post(':id/reject')
    reject(@Param('id') id: string, @Body() dto: GeneralPaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canApprove((req as any).session?.auth)) throw new ForbiddenException('PAYMENT_REQUEST_APPROVAL_FORBIDDEN')
        return this.service.decide(id, false, dto.note, (req as any).user?.id)
    }

    @Post(':id/bank-verify')
    bankVerify(@Param('id') id: string, @Body() dto: GeneralPaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.bankCheck(id, true, dto.note, (req as any).user?.id)
    }

    @Post(':id/bank-return')
    bankReturn(@Param('id') id: string, @Body() dto: GeneralPaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.bankCheck(id, false, dto.note, (req as any).user?.id)
    }

    @Post(':id/resubmit')
    resubmit(@Param('id') id: string, @Body() dto: GeneralPaymentRequestDecisionDto) {
        return this.service.resubmit(id, dto)
    }

    @Post(':id/payments')
    recordPayment(@Param('id') id: string, @Body() dto: RecordGeneralPaymentDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.recordPayment(id, dto, (req as any).user?.id)
    }

    @Get('reconciliation-queue')
    reconciliationQueue() {
        return this.service.reconciliationQueue()
    }

    @Get('reconciliations/recent')
    recentReconciliations() {
        return this.service.recentReconciliations()
    }

    @Post('reconciliation/:bankTransactionId')
    reconcile(@Param('bankTransactionId') bankTransactionId: string, @Body() dto: MatchGeneralPaymentReconciliationDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.reconcile(bankTransactionId, dto, (req as any).user?.id)
    }

    @Post('reconciliation/:reconciliationId/reverse')
    reverse(@Param('reconciliationId') reconciliationId: string, @Body() dto: ReverseGeneralPaymentReconciliationDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.reverseReconciliation(reconciliationId, dto, (req as any).user?.id)
    }
}
