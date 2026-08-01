export const PURCHASE_NOTIFICATION_EVENTS = {
    ORDER_PENDING_APPROVAL: 'purchase.order.pending_approval',
    ORDER_APPROVED: 'purchase.order.approved',
    ORDER_CANCELLED: 'purchase.order.cancelled',
    INVOICE_POSTED: 'purchase.invoice.posted',
    PAYMENT_APPROVAL_REQUESTED: 'purchase.payment.approval_requested',
    PAYMENT_APPROVED: 'purchase.payment.approved',
    PAYMENT_REJECTED: 'purchase.payment.rejected',
    PAYMENT_RESUBMITTED: 'purchase.payment.resubmitted',
    PAYMENT_BANK_VERIFIED: 'purchase.payment.bank_verified',
    PAYMENT_BANK_RETURNED: 'purchase.payment.bank_returned',
    PAYMENT_RECORDED: 'purchase.payment.recorded',
    PAYMENT_COMPLETED: 'purchase.payment.completed',
    WITHDRAWAL_CONFIRMED: 'purchase.withdrawal.confirmed',
    WITHDRAWAL_CANCELLED: 'purchase.withdrawal.cancelled',
    RECEIPT_REQUESTED: 'purchase.receipt.requested',
    RECEIPT_CONFIRMED: 'purchase.receipt.confirmed',
    RECEIPT_REJECTED: 'purchase.receipt.rejected',
    SALES_ORDER_REQUESTED: 'sales.order.requested',
} as const

export type PurchaseNotificationEvent =
    (typeof PURCHASE_NOTIFICATION_EVENTS)[keyof typeof PURCHASE_NOTIFICATION_EVENTS]

