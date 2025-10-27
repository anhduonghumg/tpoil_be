import { Controller, Get, Req } from '@nestjs/common'
import { EmployeesService } from './modules/employees/employees.service'

@Controller()
export class AppController {
    constructor(private readonly employeesService: EmployeesService) {}

    @Get('bootstrap')
    async bootstrap(@Req() req: any) {
        const birthdays = await this.employeesService.birthdays()
        return {
            data: {
                me: req.user ?? null,
                notifications: { birthdays },
            },
        }
    }
}
