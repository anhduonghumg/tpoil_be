import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    PayableEntryType,
    PayableOpenItemStatus,
    Prisma,
    PurchaseBizType,
    PurchaseOrderType,
    SupplierInvoiceStatus,
    TermPaymentRequestStatus,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'
import {
    CreateCommercialPaymentRequestDto,
    PaymentRequestDecisionDto,
    RecordCommercialPaymentDto,
} from './dto/commercial-payment.dto'

/**
 * Invoice-based payment requests shared by both commercial purchase types
 * (LOT and SINGLE). TERM orders use their own document-based flow.
 */
@Injectable()
export class CommercialPaymentsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    /** Notifications deep-link differently for lot and retail purchases. */
    private entityTypeOf(orderType: PurchaseOrderType) {
        return orderType === PurchaseOrderType.LOT
            ? 'COMMERCIAL_PURCHASE'
            : 'COMMERCIAL_PURCHASE_RETAIL'
    }

    async listPaymentRequests() {
        const requests = await this.prisma.purchaseTermPaymentRequest.findMany({
            where: {
                supplierInvoiceId: { not: null },
                purchaseOrder: { bizType: PurchaseBizType.COMMERCIAL },
            },
            orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
            include: {
                purchaseOrder: {
                    select: {
                        id: true,
                        orderNo: true,
                        orderType: true,
                        supplier: { select: { code: true, name: true } },
                    },
                },
                supplierInvoice: {
                    select: {
                        id: true,
                        invoiceNo: true,
                        invoiceDate: true,
                        lines: { select: { actualQty: true } },
                    },
                },
                payments: {
                    orderBy: [{ paidAt: 'desc' }, { createdAt: 'desc' }],
                    include: {
                        sourceBankAccount: {
                            select: { id: true, bankCode: true, bankName: true, accountNo: true },
                        },
                    },
                },
            },
        })

        return requests.map((request) => {
            const paidAmount = request.payments.reduce(
                (sum, payment) => sum.plus(payment.amountVnd),
                new Prisma.Decimal(0),
            )
            return {
                ...request,
                quantity:
                    request.supplierInvoice?.lines.reduce(
                        (sum, line) => sum.plus(line.actualQty ?? 0),
                        new Prisma.Decimal(0),
                    ) ?? new Prisma.Decimal(0),
                paidAmount,
                remainingAmount: request.amountVnd.minus(paidAmount),
            }
        })
    }

    async createPaymentRequest(purchaseOrderId: string, dto: CreateCommercialPaymentRequestDto) {
        const order = await this.prisma.purchaseOrder.findFirst({
            where: { id: purchaseOrderId, bizType: PurchaseBizType.COMMERCIAL },
            include: {
                supplier: {
                    select: {
                        name: true,
                        bankAccountNo: true,
                        bankAccounts: {
                            where: { isActive: true },
                            orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                        },
                    },
                },
                supplierInvoices: {
                    include: { openItem: true, paymentRequests: true },
                },
            },
        })
        if (!order) throw new NotFoundException('COMMERCIAL_PURCHASE_NOT_FOUND')

        const invoice = order.supplierInvoices.find((item) => item.id === dto.supplierInvoiceId)
        if (!invoice || invoice.status !== SupplierInvoiceStatus.POSTED || !invoice.openItem) {
            throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_INVOICE_NOT_POSTED')
        }
        if (invoice.openItem.outstandingAmount.lessThanOrEqualTo(0)) {
            throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_INVOICE_SETTLED')
        }
        const outstandingAmount = invoice.openItem.outstandingAmount

        const existing = invoice.paymentRequests.find(
            (item) => item.status !== TermPaymentRequestStatus.CANCELLED,
        )
        if (existing) return existing

        const beneficiary = dto.beneficiaryBankAccountId
            ? order.supplier.bankAccounts.find((item) => item.id === dto.beneficiaryBankAccountId)
            : order.supplier.bankAccounts[0]
        const beneficiaryAccountNo =
            dto.beneficiaryAccountNo?.trim() ||
            beneficiary?.accountNo ||
            order.supplier.bankAccountNo?.trim()
        if (!beneficiaryAccountNo) throw new BadRequestException('SUPPLIER_BANK_ACCOUNT_REQUIRED')

        return this.prisma.$transaction(async (tx) => {
            const request = await tx.purchaseTermPaymentRequest.create({
                data: {
                    purchaseOrderId: order.id,
                    supplierInvoiceId: invoice.id,
                    requestNo: `${order.orderNo}-DNTT-${invoice.invoiceNo}`,
                    requestDate: new Date(),
                    supplierName: order.supplier.name,
                    beneficiaryBankAccountId: beneficiary?.id ?? null,
                    beneficiaryAccountNo,
                    beneficiaryAccountName: beneficiary?.accountName ?? order.supplier.name,
                    beneficiaryBankName: beneficiary?.bankName ?? null,
                    content: `Đề nghị thanh toán hóa đơn ${invoice.invoiceNo} của đơn ${order.orderNo}`,
                    amountVnd: outstandingAmount,
                    currency: invoice.currency,
                    paymentDeadline: dto.paymentDeadline ? new Date(dto.paymentDeadline) : null,
                    status: TermPaymentRequestStatus.PENDING_DIRECTOR_APPROVAL,
                    note: dto.note?.trim() || null,
                },
            })
            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.PAYMENT_APPROVAL_REQUESTED,
                    aggregateType: 'COMMERCIAL_PURCHASE_PAYMENT',
                    aggregateId: request.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.PAYMENT_APPROVAL_REQUESTED}:${request.id}`,
                    payload: {
                        entityType: this.entityTypeOf(order.orderType),
                        entityId: order.id,
                        workItemSourceType: 'COMMERCIAL_PURCHASE_PAYMENT',
                        workItemSourceId: request.id,
                        orderNo: order.orderNo,
                        requestNo: request.requestNo,
                        actionRequired: true,
                        recipientPermissionCodes: ['purchases.payment_requests.approve'],
                    },
                },
                tx,
            )
            return request
        })
    }

    async decidePaymentRequest(
        purchaseOrderId: string,
        requestId: string,
        approve: boolean,
        note: string | undefined,
        actorId?: string | null,
    ) {
        const request = await this.prisma.purchaseTermPaymentRequest.findFirst({
            where: { id: requestId, purchaseOrderId, supplierInvoiceId: { not: null } },
        })
        if (!request) throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
        if (request.status !== TermPaymentRequestStatus.PENDING_DIRECTOR_APPROVAL) {
            throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_NOT_PENDING_APPROVAL')
        }
        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            select: { orderNo: true, orderType: true, createdById: true },
        })
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchaseTermPaymentRequest.update({
                where: { id: request.id },
                data: approve
                    ? {
                          status: TermPaymentRequestStatus.SUBMITTED,
                          approvedById: actorId ?? null,
                          approvedAt: new Date(),
                          approvalNote: note?.trim() || null,
                      }
                    : {
                          status: TermPaymentRequestStatus.DIRECTOR_REJECTED,
                          approvalNote: note?.trim() || null,
                      },
            })
            const eventType = approve
                ? PURCHASE_NOTIFICATION_EVENTS.PAYMENT_APPROVED
                : PURCHASE_NOTIFICATION_EVENTS.PAYMENT_REJECTED
            await this.notificationOutbox.emit(
                {
                    eventType,
                    aggregateType: 'COMMERCIAL_PURCHASE_PAYMENT',
                    aggregateId: request.id,
                    dedupeKey: `${eventType}:${request.id}:${updated.updatedAt.toISOString()}`,
                    payload: {
                        entityType: this.entityTypeOf(
                            order?.orderType ?? PurchaseOrderType.SINGLE,
                        ),
                        entityId: purchaseOrderId,
                        workItemSourceType: 'COMMERCIAL_PURCHASE_PAYMENT',
                        workItemSourceId: request.id,
                        orderNo: order?.orderNo ?? '',
                        requestNo: request.requestNo,
                        actionRequired: !approve,
                        resolvedActions: ['REVIEW_PURCHASE_PAYMENT'],
                        recipientUserIds: order?.createdById ? [order.createdById] : [],
                        recipientPermissionPrefixes: approve ? ['banking.'] : [],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )
            return updated
        })
    }

    async resubmitPaymentRequest(
        purchaseOrderId: string,
        requestId: string,
        dto: PaymentRequestDecisionDto,
    ) {
        const request = await this.prisma.purchaseTermPaymentRequest.findFirst({
            where: { id: requestId, purchaseOrderId, supplierInvoiceId: { not: null } },
        })
        if (!request) throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
        if (
            request.status !== TermPaymentRequestStatus.DIRECTOR_REJECTED &&
            request.status !== TermPaymentRequestStatus.BANK_RETURNED
        ) {
            throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_NOT_RETURNED')
        }
        const beneficiaryAccountNo =
            dto.beneficiaryAccountNo?.trim() || request.beneficiaryAccountNo
        if (!beneficiaryAccountNo) throw new BadRequestException('SUPPLIER_BANK_ACCOUNT_REQUIRED')
        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            select: { orderNo: true, orderType: true },
        })
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchaseTermPaymentRequest.update({
                where: { id: request.id },
                data: {
                    status: TermPaymentRequestStatus.PENDING_DIRECTOR_APPROVAL,
                    note: dto.note?.trim() || request.note,
                    beneficiaryAccountNo,
                    returnedReason: null,
                },
            })
            await this.notificationOutbox.emit(
                {
                    eventType: PURCHASE_NOTIFICATION_EVENTS.PAYMENT_RESUBMITTED,
                    aggregateType: 'COMMERCIAL_PURCHASE_PAYMENT',
                    aggregateId: request.id,
                    dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.PAYMENT_RESUBMITTED}:${request.id}:${updated.updatedAt.toISOString()}`,
                    payload: {
                        entityType: this.entityTypeOf(
                            order?.orderType ?? PurchaseOrderType.SINGLE,
                        ),
                        entityId: purchaseOrderId,
                        workItemSourceType: 'COMMERCIAL_PURCHASE_PAYMENT',
                        workItemSourceId: request.id,
                        orderNo: order?.orderNo ?? '',
                        requestNo: request.requestNo,
                        actionRequired: true,
                        resolvedActions: ['EDIT_PURCHASE_PAYMENT'],
                        recipientPermissionCodes: ['purchases.payment_requests.approve'],
                    },
                },
                tx,
            )
            return updated
        })
    }

    async bankCheckPaymentRequest(
        requestId: string,
        verified: boolean,
        note: string | undefined,
        actorId?: string | null,
    ) {
        const request = await this.prisma.purchaseTermPaymentRequest.findFirst({
            where: { id: requestId, supplierInvoiceId: { not: null } },
        })
        if (!request) throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
        if (request.status !== TermPaymentRequestStatus.SUBMITTED)
            throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_NOT_PENDING_BANK')
        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id: request.purchaseOrderId },
            select: { orderNo: true, orderType: true, createdById: true },
        })
        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchaseTermPaymentRequest.update({
                where: { id: request.id },
                data: verified
                    ? {
                          status: TermPaymentRequestStatus.BANK_VERIFIED,
                          bankCheckedById: actorId ?? null,
                          bankCheckedAt: new Date(),
                          bankCheckNote: note?.trim() || null,
                      }
                    : {
                          status: TermPaymentRequestStatus.BANK_RETURNED,
                          returnedReason: note?.trim() || 'Ngân hàng yêu cầu mua hàng kiểm tra lại',
                      },
            })
            const eventType = verified
                ? PURCHASE_NOTIFICATION_EVENTS.PAYMENT_BANK_VERIFIED
                : PURCHASE_NOTIFICATION_EVENTS.PAYMENT_BANK_RETURNED
            await this.notificationOutbox.emit(
                {
                    eventType,
                    aggregateType: 'COMMERCIAL_PURCHASE_PAYMENT',
                    aggregateId: request.id,
                    dedupeKey: `${eventType}:${request.id}:${updated.updatedAt.toISOString()}`,
                    payload: {
                        entityType: this.entityTypeOf(
                            order?.orderType ?? PurchaseOrderType.SINGLE,
                        ),
                        entityId: request.purchaseOrderId,
                        workItemSourceType: 'COMMERCIAL_PURCHASE_PAYMENT',
                        workItemSourceId: request.id,
                        orderNo: order?.orderNo ?? '',
                        requestNo: request.requestNo,
                        returnedReason: updated.returnedReason ?? '',
                        actionRequired: !verified,
                        resolvedActions: verified ? [] : ['PROCESS_PURCHASE_PAYMENT'],
                        recipientUserIds: order?.createdById ? [order.createdById] : [],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )
            return updated
        })
    }

    async recordPayment(
        requestId: string,
        dto: RecordCommercialPaymentDto,
        actorId?: string | null,
    ) {
        return this.prisma.$transaction(async (tx) => {
            const initialRequest = await tx.purchaseTermPaymentRequest.findFirst({
                where: { id: requestId, supplierInvoiceId: { not: null } },
                include: { supplierInvoice: { include: { openItem: true } } },
            })
            if (!initialRequest?.supplierInvoice?.openItem) {
                throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
            }

            // Payments for the same invoice must be serialized so the payable balance cannot
            // be settled twice by simultaneous payment requests.
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ap:${initialRequest.supplierInvoice.openItem.id}`}))`

            const request = await tx.purchaseTermPaymentRequest.findFirst({
                where: { id: requestId, supplierInvoiceId: { not: null } },
                include: { payments: true, supplierInvoice: { include: { openItem: true } } },
            })
            if (!request?.supplierInvoice?.openItem)
                throw new NotFoundException('COMMERCIAL_PAYMENT_REQUEST_NOT_FOUND')
            if (
                request.status !== TermPaymentRequestStatus.BANK_VERIFIED &&
                request.status !== TermPaymentRequestStatus.PARTIALLY_PAID
            )
                throw new BadRequestException('COMMERCIAL_PAYMENT_REQUEST_NOT_READY_TO_PAY')
            const source = await tx.bankAccount.findFirst({
                where: { id: dto.sourceBankAccountId, isActive: true },
            })
            if (!source) throw new BadRequestException('SOURCE_BANK_ACCOUNT_INVALID')
            const paid = request.payments.reduce(
                (sum, item) => sum.plus(item.amountVnd),
                new Prisma.Decimal(0),
            )
            const remaining = request.amountVnd.minus(paid)
            const amount = new Prisma.Decimal(dto.amountVnd)
            if (amount.greaterThan(remaining))
                throw new BadRequestException('PAYMENT_AMOUNT_EXCEEDS_REMAINING')
            const openItem = request.supplierInvoice.openItem
            if (amount.greaterThan(openItem.outstandingAmount)) {
                throw new BadRequestException('PAYMENT_AMOUNT_EXCEEDS_INVOICE_OUTSTANDING')
            }
            const paidAt = new Date(dto.paidAt)
            const payment = await tx.paymentRequestPayment.create({
                data: {
                    paymentRequestId: request.id,
                    sourceBankAccountId: source.id,
                    amountVnd: amount,
                    paidAt,
                    proofFileUrl: dto.proofFileUrl?.trim() || null,
                    proofFileName: dto.proofFileName?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                },
            })
            const outstandingAmount = new Prisma.Decimal(openItem.outstandingAmount).minus(amount)
            await tx.payableLedgerEntry.create({
                data: {
                    openItemId: openItem.id,
                    type: PayableEntryType.PAYMENT,
                    amountDelta: amount.negated(),
                    idempotencyKey: `commercial-payment:${payment.id}`,
                    effectiveAt: paidAt,
                },
            })
            await tx.payableOpenItem.update({
                where: { id: openItem.id },
                data: {
                    outstandingAmount,
                    status: outstandingAmount.isZero()
                        ? PayableOpenItemStatus.SETTLED
                        : PayableOpenItemStatus.PARTIALLY_SETTLED,
                    version: { increment: 1 },
                },
            })
            const nextPaid = paid.plus(amount)
            const updated = await tx.purchaseTermPaymentRequest.update({
                where: { id: request.id },
                data: {
                    status: nextPaid.greaterThanOrEqualTo(request.amountVnd)
                        ? TermPaymentRequestStatus.PAID
                        : TermPaymentRequestStatus.PARTIALLY_PAID,
                },
            })
            const order = await tx.purchaseOrder.findUnique({
                where: { id: request.purchaseOrderId },
                select: { orderNo: true, orderType: true, createdById: true },
            })
            const completed = updated.status === TermPaymentRequestStatus.PAID
            const eventType = completed
                ? PURCHASE_NOTIFICATION_EVENTS.PAYMENT_COMPLETED
                : PURCHASE_NOTIFICATION_EVENTS.PAYMENT_RECORDED
            await this.notificationOutbox.emit(
                {
                    eventType,
                    aggregateType: 'COMMERCIAL_PURCHASE_PAYMENT',
                    aggregateId: request.id,
                    dedupeKey: `${eventType}:${payment.id}`,
                    payload: {
                        entityType: this.entityTypeOf(
                            order?.orderType ?? PurchaseOrderType.SINGLE,
                        ),
                        entityId: request.purchaseOrderId,
                        workItemSourceType: 'COMMERCIAL_PURCHASE_PAYMENT',
                        workItemSourceId: request.id,
                        orderNo: order?.orderNo ?? '',
                        requestNo: request.requestNo,
                        amountText: `${Number(amount).toLocaleString('vi-VN')} đ`,
                        resolvedActions: completed ? ['PROCESS_PURCHASE_PAYMENT'] : [],
                        recipientUserIds: order?.createdById ? [order.createdById] : [],
                        recipientPermissionPrefixes: ['purchases.'],
                        excludeUserIds: actorId ? [actorId] : [],
                    },
                },
                tx,
            )
            return updated
        })
    }
}
