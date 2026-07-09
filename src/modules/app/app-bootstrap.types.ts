export interface ContractsNotifications {
    expiringCount: number
    expiredCount: number
}

export interface TermPaymentsNotifications {
    pendingCount: number
}

export interface TermPurchasePaymentNotifications {
    paidCount: number
}

export interface NotificationsPayload {
    contracts: ContractsNotifications
    termPayments: TermPaymentsNotifications
    termPurchasePayments: TermPurchasePaymentNotifications
    // birthdays?: BirthdaysNotifications;
}

export interface AppBootstrapResponse {
    notifications: {
        contracts: ContractsNotifications
        termPayments: TermPaymentsNotifications
        termPurchasePayments: TermPurchasePaymentNotifications
        birthdays: {
            month: number
            count: number
            items: {
                id: string
                fullName: string
                dob: string
            }[]
        }
    }
    auth?: {
        permissions: string[]
        roles?: string[]
    }
}
