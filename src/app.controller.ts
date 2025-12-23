import { Controller, Get } from '@nestjs/common'
import { EmployeesService } from './modules/employees/employees.service'

@Controller()
export class AppController {
    constructor(private readonly employeesService: EmployeesService) {}

    @Get('bootstrap')
    async bootstrap() {}
}
