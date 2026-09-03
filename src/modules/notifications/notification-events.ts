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

/** Internal sales flow (SINGLE/LOT) — sales-implementation-spec v1.2 §13. */
export const SALES_NOTIFICATION_EVENTS = {
    ORDER_REVIEW_REQUESTED: 'sales.order.review_requested',
    ORDER_APPROVED: 'sales.order.approved',
    ORDER_REJECTED: 'sales.order.rejected',
    ORDER_RECALLED: 'sales.order.recalled',
    ORDER_CANCELLED: 'sales.order.cancelled',
    ORDER_STOCK_INSUFFICIENT: 'sales.order.stock_insufficient',
    DELIVERY_READY: 'sales.delivery.ready',
    DELIVERY_RETURNED: 'sales.delivery.returned',
    DELIVERY_POSTED: 'sales.delivery.posted',
    RECONCILIATION_VARIANCE: 'sales.reconciliation.variance',
    RECONCILIATION_RESOLVED: 'sales.reconciliation.resolved',
    WITHDRAWAL_NEED_SOURCE: 'sales.withdrawal.need_source',
    WITHDRAWAL_REVIEW_REQUESTED: 'sales.withdrawal.review_requested',
    WITHDRAWAL_APPROVED: 'sales.withdrawal.approved',
    WITHDRAWAL_REJECTED: 'sales.withdrawal.rejected',
    WITHDRAWAL_CANCELLED: 'sales.withdrawal.cancelled',
    RECEIVABLE_OVERDUE: 'sales.receivable.overdue',
    INVOICE_ISSUED: 'sales.invoice.issued',
    INVOICE_ISSUE_FAILED: 'sales.invoice.issue_failed',
    INVOICE_CANCELLED: 'sales.invoice.cancelled',
} as const

export type SalesNotificationEvent =
    (typeof SALES_NOTIFICATION_EVENTS)[keyof typeof SALES_NOTIFICATION_EVENTS]

