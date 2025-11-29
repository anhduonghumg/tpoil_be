// src/modules/app/app-bootstrap.service.ts
import { Injectable } from '@nestjs/common'
import { ContractsService } from '../contracts/contracts.service'
import { AppBootstrapResponse } from './app-bootstrap.types'
import { EmployeesService } from '../employees/employees.service'

@Injectable()
export class AppBootstrapService {
    constructor(
        private readonly contractsService: ContractsService,
        private readonly employeesService: EmployeesService,
    ) {}

    /**
     * Hàm bootstrap tổng hợp dữ liệu cho client sau khi login.
     * Hiện tại mới trả notifications.contracts,
     * user, menus, birthdays...
     */
    async bootstrap(): Promise<AppBootstrapResponse> {
        const now = new Date()
        const month = now.getMonth() + 1

        const [birthdays, contractsExpiry] = await Promise.all([this.employeesService.birthdays(month), this.contractsService.getContractExpiryCounts()])

        return {
            notifications: {
                contracts: {
                    expiringCount: contractsExpiry.expiringCount,
                    expiredCount: contractsExpiry.expiredCount,
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
        }
    }
}
