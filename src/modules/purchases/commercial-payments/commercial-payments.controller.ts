import { Body, Controller, ForbiddenException, Get, Param, Post, Req, UseGuards } from '@nestjs/common'
import type { Request } from 'express'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { CommercialPaymentsService } from './commercial-payments.service'
import {
    CreateCommercialPaymentRequestDto,
    PaymentRequestDecisionDto,
    RecordCommercialPaymentDto,
} from './dto/commercial-payment.dto'

@UseGuards(LoggedInGuard)
@Controller('commercial-purchases')
export class CommercialPaymentsController {
    constructor(private readonly service: CommercialPaymentsService) {}

    private canApprovePaymentRequest(actor: any) {
        const permissions = actor?.permissions ?? []
        const roleNames = (actor?.roles ?? []).map((role: any) => typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`).join(' ')
        const isDirector = /director|giám đốc|giam doc/i.test(roleNames)
        const isSystemAdmin = /system-admin|admin|quản trị|quan tri/i.test(roleNames)
        return isDirector || isSystemAdmin || permissions.includes('system.rbac.admin') || permissions.includes('purchases.payment_requests.approve')
    }

    private canManageBankPayment(actor: any) {
        const permissions = actor?.permissions ?? []
        const roleNames = (actor?.roles ?? []).map((role: any) => typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`).join(' ')
        const isBankUser = /bank|ngân hàng|ngan hang/i.test(roleNames)
        const isSystemAdmin = /system-admin|admin|quản trị|quan tri/i.test(roleNames)
        return isBankUser || isSystemAdmin || permissions.includes('system.rbac.admin') || permissions.some((code: string) => code.startsWith('banking.'))
    }

    @Get('payment-requests')
    listPaymentRequests() {
        return this.service.listPaymentRequests()
    }

    @Post(':id/payment-requests')
    createPaymentRequest(@Param('id') id: string, @Body() dto: CreateCommercialPaymentRequestDto) {
        return this.service.createPaymentRequest(id, dto)
    }

    @Post(':id/payment-requests/:requestId/approve')
    approvePaymentRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: PaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canApprovePaymentRequest((req as any).session?.auth)) throw new ForbiddenException('PAYMENT_REQUEST_APPROVAL_FORBIDDEN')
        return this.service.decidePaymentRequest(id, requestId, true, dto.note, (req as any).user?.id)
    }

    @Post(':id/payment-requests/:requestId/reject')
    rejectPaymentRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: PaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canApprovePaymentRequest((req as any).session?.auth)) throw new ForbiddenException('PAYMENT_REQUEST_APPROVAL_FORBIDDEN')
        return this.service.decidePaymentRequest(id, requestId, false, dto.note, (req as any).user?.id)
    }

    @Post(':id/payment-requests/:requestId/resubmit')
    resubmitPaymentRequest(@Param('id') id: string, @Param('requestId') requestId: string, @Body() dto: PaymentRequestDecisionDto) {
        return this.service.resubmitPaymentRequest(id, requestId, dto)
    }

    @Post(':id/payment-requests/:requestId/bank-verify')
    bankVerifyPaymentRequest(@Param('requestId') requestId: string, @Body() dto: PaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.bankCheckPaymentRequest(requestId, true, dto.note, (req as any).user?.id)
    }

    @Post(':id/payment-requests/:requestId/bank-return')
    bankReturnPaymentRequest(@Param('requestId') requestId: string, @Body() dto: PaymentRequestDecisionDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.bankCheckPaymentRequest(requestId, false, dto.note, (req as any).user?.id)
    }

    @Post(':id/payment-requests/:requestId/payments')
    recordPayment(@Param('requestId') requestId: string, @Body() dto: RecordCommercialPaymentDto, @Req() req: Request) {
        if (!this.canManageBankPayment((req as any).session?.auth)) throw new ForbiddenException('BANK_PAYMENT_PROCESSING_FORBIDDEN')
        return this.service.recordPayment(requestId, dto, (req as any).user?.id)
    }
}
