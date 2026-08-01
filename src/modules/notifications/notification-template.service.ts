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
