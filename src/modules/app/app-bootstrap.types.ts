export interface ContractsNotifications {
    expiringCount: number
    expiredCount: number
}

export interface NotificationsPayload {
    contracts: ContractsNotifications
    // birthdays?: BirthdaysNotifications;
}

export interface AppBootstrapResponse {
    notifications: {
        contracts: ContractsNotifications
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
}
