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
        const canSeeBankingNotifications = permissions.some((code) => code === 'system.rbac.admin' || code.startsWith('banking.'))
        const canSeePurchaseNotifications = permissions.some((code) => code === 'system.rbac.admin' || code.startsWith('purchases.'))
        const recentPaymentThreshold = new Date()
        recentPaymentThreshold.setDate(recentPaymentThreshold.getDate() - 7)

        const [birthdays, contractsExpiry, pendingTermPayments, paidTermPayments] = await Promise.all([
            this.employeesService.birthdays(month),
            this.contractsService.getContractExpiryCounts(),
            canSeeBankingNotifications
                ? this.prisma.purchaseTermPaymentRequest.count({
                      where: {
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
                          status: {
                              in: [TermPaymentRequestStatus.PAID, TermPaymentRequestStatus.PARTIALLY_PAID],
                          },
                          updatedAt: {
                              gte: recentPaymentThreshold,
                          },
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
