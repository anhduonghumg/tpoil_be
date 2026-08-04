import { Injectable } from '@nestjs/common'
import { NotificationSeverity } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

type TemplateDefinition = {
    moduleCode: string
    category: string
    severity: NotificationSeverity
    title: string
    body: string
    action?: string
}

const TEMPLATES: Record<string, TemplateDefinition> = {
    'purchase.order.pending_approval': {
        moduleCode: 'purchases',
        category: 'PURCHASE_APPROVAL',
        severity: 'WARNING',
        title: 'Đơn mua {{orderNo}} đang chờ duyệt',
        body: '{{actorName}} đã tạo đơn mua lô {{orderNo}}.',
        action: 'REVIEW_PURCHASE_ORDER',
    },
    'purchase.order.approved': {
        moduleCode: 'purchases',
        category: 'PURCHASE_ORDER',
        severity: 'SUCCESS',
        title: 'Đơn mua {{orderNo}} đã được duyệt',
        body: 'Đơn mua lô {{orderNo}} đã được duyệt và chuyển sang bước nhận hóa đơn.',
        action: 'VIEW_PURCHASE_ORDER',
    },
    'purchase.order.cancelled': {
        moduleCode: 'purchases',
        category: 'PURCHASE_ORDER',
        severity: 'ERROR',
        title: 'Đơn mua {{orderNo}} đã bị hủy',
        body: 'Đơn mua lô {{orderNo}} đã bị hủy. Vui lòng kiểm tra lại.',
        action: 'VIEW_PURCHASE_ORDER',
    },
    'purchase.invoice.posted': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'INFO',
        title: 'Đã ghi nhận hóa đơn {{invoiceNo}}',
        body: 'Đơn {{orderNo}} đã có hóa đơn và cần lập đề nghị thanh toán.',
        action: 'VIEW_PURCHASE_PAYMENT',
    },
    'purchase.payment.approval_requested': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT_APPROVAL',
        severity: 'WARNING',
        title: 'Đề nghị thanh toán {{requestNo}} chờ duyệt',
        body: 'Đề nghị thanh toán của đơn {{orderNo}} đang chờ giám đốc duyệt.',
        action: 'REVIEW_PURCHASE_PAYMENT',
    },
    'purchase.payment.approved': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'SUCCESS',
        title: 'Đề nghị {{requestNo}} đã được duyệt',
        body: 'Đề nghị thanh toán của đơn {{orderNo}} đã được duyệt và chuyển ngân hàng.',
        action: 'PROCESS_PURCHASE_PAYMENT',
    },
    'purchase.payment.rejected': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'ERROR',
        title: 'Đề nghị {{requestNo}} bị từ chối',
        body: 'Đề nghị thanh toán của đơn {{orderNo}} cần được kiểm tra lại.',
        action: 'EDIT_PURCHASE_PAYMENT',
    },
    'purchase.payment.resubmitted': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT_APPROVAL',
        severity: 'WARNING',
        title: 'Đề nghị {{requestNo}} đã gửi duyệt lại',
        body: 'Đề nghị thanh toán của đơn {{orderNo}} đang chờ duyệt lại.',
        action: 'REVIEW_PURCHASE_PAYMENT',
    },
    'purchase.payment.bank_verified': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'INFO',
        title: 'Đề nghị {{requestNo}} đã được ngân hàng kiểm tra',
        body: 'Đề nghị thanh toán của đơn {{orderNo}} đã sẵn sàng ghi nhận thanh toán.',
        action: 'PROCESS_PURCHASE_PAYMENT',
    },
    'purchase.payment.bank_returned': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'ERROR',
        title: 'Ngân hàng trả lại đề nghị {{requestNo}}',
        body: '{{returnedReason}}',
        action: 'EDIT_PURCHASE_PAYMENT',
    },
    'purchase.payment.recorded': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'INFO',
        title: 'Đã ghi nhận thanh toán đơn {{orderNo}}',
        body: 'Đã thanh toán {{amountText}} cho đề nghị {{requestNo}}.',
        action: 'VIEW_PURCHASE_PAYMENT',
    },
    'purchase.payment.completed': {
        moduleCode: 'purchases',
        category: 'PURCHASE_PAYMENT',
        severity: 'SUCCESS',
        title: 'Đơn {{orderNo}} đã thanh toán đủ',
        body: 'Đơn mua đã đủ điều kiện chuyển sang bước rút lô.',
        action: 'VIEW_PURCHASE_ORDER',
    },
    'purchase.withdrawal.confirmed': {
        moduleCode: 'purchases',
        category: 'PURCHASE_WITHDRAWAL',
        severity: 'SUCCESS',
        title: 'Đã xác nhận rút lô {{withdrawalNo}}',
        body: 'Đơn {{orderNo}} đã rút hàng về kho {{warehouseCode}}.',
        action: 'VIEW_PURCHASE_WITHDRAWAL',
    },
    'purchase.withdrawal.cancelled': {
        moduleCode: 'purchases',
        category: 'PURCHASE_WITHDRAWAL',
        severity: 'WARNING',
        title: 'Phiếu rút {{withdrawalNo}} đã bị hủy',
        body: 'Phiếu rút thuộc đơn {{orderNo}} đã bị hủy.',
        action: 'VIEW_PURCHASE_ORDER',
    },
    'purchase.receipt.requested': {
        moduleCode: 'purchases',
        category: 'PURCHASE_RECEIPT',
        severity: 'WARNING',
        title: 'Đề nghị nhập hàng {{receiptNo}} chờ kho xác nhận',
        body: 'Đơn {{orderNo}} đề nghị nhập hàng về kho {{warehouseCode}}.',
        action: 'CONFIRM_PURCHASE_RECEIPT',
    },
    'purchase.receipt.confirmed': {
        moduleCode: 'purchases',
        category: 'PURCHASE_RECEIPT',
        severity: 'SUCCESS',
        title: 'Kho đã xác nhận nhập hàng {{receiptNo}}',
        body: 'Đơn {{orderNo}} đã nhập kho {{warehouseCode}} và cộng tồn.',
        action: 'VIEW_PURCHASE_ORDER',
    },
    'sales.order.requested': {
        moduleCode: 'purchases',
        category: 'SALES_ORDER',
        severity: 'WARNING',
        title: 'Đơn đặt hàng {{orderNo}} cần đi mua',
        body: 'Khách {{customerName}} đặt hàng, đề nghị mua hàng đặt hàng nhà cung cấp.',
        action: 'CREATE_PURCHASE_FOR_SALES_ORDER',
    },
    'sales.order.review_requested': {
        moduleCode: 'sales',
        category: 'SALES_ORDER_APPROVAL',
        severity: 'WARNING',
        title: 'Đơn bán {{orderNo}} chờ duyệt {{approvalTypeLabel}}',
        body: 'Khách {{customerName}}. {{reasonSummary}}',
        action: 'APPROVE_SALES_ORDER',
    },
    'sales.order.approved': {
        moduleCode: 'sales',
        category: 'SALES_ORDER',
        severity: 'SUCCESS',
        title: 'Đơn bán {{orderNo}} đã được duyệt',
        body: 'Đơn bán cho khách {{customerName}} đã được duyệt và sẵn sàng bước tiếp theo.',
        action: 'VIEW_SALES_ORDER',
    },
    'sales.order.rejected': {
        moduleCode: 'sales',
        category: 'SALES_ORDER',
        severity: 'ERROR',
        title: 'Đơn bán {{orderNo}} bị từ chối',
        body: '{{deciderName}} từ chối ({{approvalTypeLabel}}): {{decisionNote}}',
        action: 'FIX_SALES_ORDER',
    },
    'sales.order.recalled': {
        moduleCode: 'sales',
        category: 'SALES_ORDER',
        severity: 'INFO',
        title: 'Đơn bán {{orderNo}} đã được thu hồi',
        body: 'Sale đã thu hồi đơn {{orderNo}} để chỉnh sửa. Yêu cầu duyệt hiện tại được đóng.',
        action: 'VIEW_SALES_ORDER',
    },
    'sales.order.cancelled': {
        moduleCode: 'sales',
        category: 'SALES_ORDER',
        severity: 'ERROR',
        title: 'Đơn bán {{orderNo}} đã bị hủy',
        body: 'Đơn bán cho khách {{customerName}} đã bị hủy. {{reasonSummary}}',
        action: 'VIEW_SALES_ORDER',
    },
    'sales.order.stock_insufficient': {
        moduleCode: 'sales',
        category: 'SALES_ORDER',
        severity: 'WARNING',
        title: 'Đơn bán {{orderNo}} chưa giữ đủ hàng',
        body: 'Khách {{customerName}}. {{shortageSummary}}',
        action: 'VIEW_SALES_ORDER',
    },
    'sales.delivery.ready': {
        moduleCode: 'sales',
        category: 'SALES_DELIVERY',
        severity: 'WARNING',
        title: 'Lệnh xuất {{deliveryNo}} chờ kho {{warehouseName}} xử lý',
        body: 'Đơn {{orderNo}} — khách {{customerName}}, xe {{vehiclePlate}}.',
        action: 'CONFIRM_SALES_DELIVERY',
    },
    'sales.withdrawal.need_source': {
        moduleCode: 'sales',
        category: 'SALES_WITHDRAWAL',
        severity: 'WARNING',
        title: 'Yêu cầu rút {{requestNo}} chưa tìm được đơn lô nguồn',
        body: 'Sale cần chọn đơn lô nguồn phù hợp cho yêu cầu rút này.',
        action: 'SELECT_WITHDRAWAL_SOURCE',
    },
    'sales.withdrawal.approved': {
        moduleCode: 'sales',
        category: 'SALES_WITHDRAWAL',
        severity: 'SUCCESS',
        title: 'Yêu cầu rút {{requestNo}} đã được duyệt',
        body: 'Rút từ đơn lô {{orderNo}} — khách {{customerName}}.',
        action: 'VIEW_SALES_WITHDRAWAL',
    },
    'sales.withdrawal.cancelled': {
        moduleCode: 'sales',
        category: 'SALES_WITHDRAWAL',
        severity: 'ERROR',
        title: 'Yêu cầu rút {{requestNo}} đã bị hủy',
        body: '{{reasonSummary}}',
        action: 'VIEW_SALES_WITHDRAWAL',
    },
    'sales.invoice.issued': {
        moduleCode: 'sales',
        category: 'SALES_INVOICE',
        severity: 'SUCCESS',
        title: 'Đã phát hành hóa đơn {{invoiceNo}}',
        body: 'Khách {{customerName}} — chứng từ {{orderNo}}, tổng tiền {{grandTotal}}.',
        action: 'VIEW_SALES_INVOICE',
    },
    'sales.invoice.issue_failed': {
        moduleCode: 'sales',
        category: 'SALES_INVOICE',
        severity: 'ERROR',
        title: 'Phát hành hóa đơn {{invoiceNo}} thất bại',
        body: 'Khách {{customerName}}: {{errorMessage}}',
        action: 'RETRY_SALES_INVOICE',
    },
    'sales.invoice.cancelled': {
        moduleCode: 'sales',
        category: 'SALES_INVOICE',
        severity: 'WARNING',
        title: 'Hóa đơn {{invoiceNo}} đã bị hủy',
        body: 'Khách {{customerName}}: {{reasonSummary}}',
        action: 'VIEW_SALES_INVOICE',
    },
    'sales.receivable.overdue': {
        moduleCode: 'sales',
        category: 'SALES_RECEIVABLE',
        severity: 'ERROR',
        title: 'Khách {{customerName}} có công nợ quá hạn',
        body: 'Tổng quá hạn {{overdueAmount}} — cần liên hệ thu hồi.',
        action: 'VIEW_RECEIVABLES',
    },
    'sales.reconciliation.variance': {
        moduleCode: 'sales',
        category: 'SALES_RECONCILIATION',
        severity: 'ERROR',
        title: 'Đối soát đơn {{orderNo}} có chênh lệch',
        body: 'Khách {{customerName}}: {{varianceSummary}}',
        action: 'RESOLVE_SALES_RECONCILIATION',
    },
    'sales.reconciliation.resolved': {
        moduleCode: 'sales',
        category: 'SALES_RECONCILIATION',
        severity: 'SUCCESS',
        title: 'Đối soát đơn {{orderNo}} đã hoàn tất',
        body: 'Khách {{customerName}} — đơn sẵn sàng lập hóa đơn.',
        action: 'VIEW_SALES_ORDER',
    },
    'sales.delivery.posted': {
        moduleCode: 'sales',
        category: 'SALES_DELIVERY',
        severity: 'SUCCESS',
        title: 'Kho {{warehouseName}} đã xuất theo lệnh {{deliveryNo}}',
        body: 'Đơn {{orderNo}} — khách {{customerName}} đã xuất kho, chuyển bước đối soát.',
        action: 'VIEW_SALES_DELIVERY',
    },
    'sales.delivery.returned': {
        moduleCode: 'sales',
        category: 'SALES_DELIVERY',
        severity: 'ERROR',
        title: 'Kho {{warehouseName}} trả lại lệnh xuất {{deliveryNo}}',
        body: 'Đơn {{orderNo}} cần Sale chỉnh sửa: {{returnedReason}}',
        action: 'FIX_SALES_DELIVERY',
    },
    'purchase.receipt.rejected': {
        moduleCode: 'purchases',
        category: 'PURCHASE_RECEIPT',
        severity: 'ERROR',
        title: 'Đề nghị nhập hàng {{receiptNo}} bị hủy',
        body: 'Đề nghị nhập hàng của đơn {{orderNo}} đã bị hủy. Vui lòng kiểm tra lại.',
        action: 'VIEW_PURCHASE_ORDER',
    },
}

@Injectable()
export class NotificationTemplateService {
    constructor(private readonly prisma: PrismaService) {}

    async render(eventType: string, payload: Record<string, unknown>) {
        const stored = await this.prisma.notificationTemplate.findUnique({
            where: { code: eventType },
        })
        if (stored && !stored.enabled) return null
        const fallback = TEMPLATES[eventType] ?? {
            moduleCode: 'common',
            category: 'GENERAL',
            severity: NotificationSeverity.INFO,
            title: 'Có thông báo mới',
            body: '',
        }
        const template = stored
            ? {
                  moduleCode: stored.moduleCode,
                  category: stored.category,
                  severity: fallback.severity,
                  title: stored.titleTemplate,
                  body: stored.bodyTemplate,
                  action: stored.defaultAction ?? fallback.action,
              }
            : fallback

        const interpolate = (value: string) =>
            value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
                const replacement = payload[key]
                return typeof replacement === 'string' ||
                    typeof replacement === 'number' ||
                    typeof replacement === 'boolean'
                    ? String(replacement)
                    : ''
            })

        return {
            ...template,
            title: interpolate(template.title),
            body: interpolate(template.body),
        }
    }
}
