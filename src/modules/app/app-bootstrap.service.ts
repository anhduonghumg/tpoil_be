// src/modules/app/app-bootstrap.service.ts
import { Injectable } from '@nestjs/common'
import { TermPaymentBatchItemStatus, TermPaymentRequestStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ContractsService } from '../contracts/contracts.service'
import { AppBootstrapResponse } from './app-bootstrap.types'
import { EmployeesService } from '../employees/employees.service'

type AnyAuthSession = { permissions?: string[]; roles?: any[] } | null | undefined

@Injectable()
export class AppBootstrapService {
    constructor(
        private readonly contractsService: ContractsService,
        private readonly employeesService: EmployeesService,
        private readonly prisma: PrismaService,
    ) {}

    /**
     * Hàm bootstrap tổng hợp dữ liệu cho client sau khi login.
     * Hiện tại mới trả notifications.contracts,
     * user, menus, birthdays...
     */
    async bootstrap(authSession?: AnyAuthSession): Promise<AppBootstrapResponse> {
        const now = new Date()
        const month = now.getMonth() + 1
        const permissions = authSession?.permissions ?? []
        const roleNames = (authSession?.roles ?? []).map((role: any) => (typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`)).join(' ')
        const canSeeBankingNotifications = /bank|ngân hàng|ngan hang/i.test(roleNames) || permissions.some((code) => code === 'system.rbac.admin' || code.startsWith('banking.'))
        const canSeePurchaseNotifications = /purchas|mua hàng|mua hang/i.test(roleNames) || permissions.some((code) => code === 'system.rbac.admin' || code.startsWith('purchases.'))
        const canApprovePayments =
            permissions.includes('system.rbac.admin') ||
            permissions.includes('purchases.payment_requests.approve') ||
            (authSession?.roles ?? []).some((role: any) => /director|giám đốc|giam doc/i.test(typeof role === 'string' ? role : `${role.code ?? ''} ${role.name ?? ''}`))
        const recentPaymentThreshold = new Date()
        recentPaymentThreshold.setDate(recentPaymentThreshold.getDate() - 7)

        const [birthdays, contractsExpiry, pendingTermPayments, paidTermPayments, directorPendingCount, bankPendingCount, purchaseApprovedCount, purchaseReturnedCount] = await Promise.all([
            this.employeesService.birthdays(month),
            this.contractsService.getContractExpiryCounts(),
            canSeeBankingNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: {
                          supplierInvoiceId: null,
                          status: {
                              in: [TermPaymentRequestStatus.DRAFT, TermPaymentRequestStatus.SUBMITTED],
                          },
                          batchItems: {
                              none: {
                                  status: {
                                      in: [
                                          TermPaymentBatchItemStatus.PENDING,
                                          TermPaymentBatchItemStatus.SENT,
                                          TermPaymentBatchItemStatus.PARTIALLY_PAID,
                                          TermPaymentBatchItemStatus.PAID,
                                      ],
                                  },
                              },
                          },
                      },
                  })
                : Promise.resolve(0),
            canSeePurchaseNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                    where: {
                        supplierInvoiceId: null,
                        status: {
                              in: [TermPaymentRequestStatus.PAID, TermPaymentRequestStatus.PARTIALLY_PAID],
                          },
                          updatedAt: {
                              gte: recentPaymentThreshold,
                          },
                      },
                  })
                : Promise.resolve(0),
            canApprovePayments
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: { supplierInvoiceId: { not: null }, status: TermPaymentRequestStatus.PENDING_DIRECTOR_APPROVAL },
                  })
                : Promise.resolve(0),
            canSeeBankingNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: { supplierInvoiceId: { not: null }, status: TermPaymentRequestStatus.SUBMITTED },
                  })
                : Promise.resolve(0),
            canSeePurchaseNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: { supplierInvoiceId: { not: null }, status: TermPaymentRequestStatus.SUBMITTED },
                  })
                : Promise.resolve(0),
            canSeePurchaseNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: {
                          supplierInvoiceId: { not: null },
                          status: { in: [TermPaymentRequestStatus.DIRECTOR_REJECTED, TermPaymentRequestStatus.BANK_RETURNED] },
                      },
                  })
                : Promise.resolve(0),
        ])

        return {
            notifications: {
                contracts: {
                    expiringCount: contractsExpiry.expiringCount,
                    expiredCount: contractsExpiry.expiredCount,
                },
                termPayments: {
                    pendingCount: pendingTermPayments,
                },
                termPurchasePayments: {
                    paidCount: paidTermPayments,
                },
                commercialPayments: {
                    directorPendingCount,
                    bankPendingCount,
                    purchaseApprovedCount,
                    purchaseReturnedCount,
                },
                birthdays: {
                    month,
                    count: birthdays?.count || 0,
                    items: (birthdays?.items || []).map((item) => ({
                        ...item,
                        dob: item.dob ? item.dob.toISOString().split('T')[0] : '',
                    })),
                },
            },
            auth: {
                permissions: authSession?.permissions ?? [],
            },
        }
    }
}
