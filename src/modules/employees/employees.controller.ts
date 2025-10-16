import { Body, Controller, Get, Post, Query, Req, UseInterceptors } from '@nestjs/common'
import { EmployeesService } from './employees.service'
import { MODULE_CODES } from 'src/common/constants/modules'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { created, paged, success } from 'src/common/http/http.response.util'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.EMPLOYEE)
@Controller('employees')
export class EmployeesController {
    constructor(private readonly svc: EmployeesService) {}

    @Get()
    async list(@Req() req: Request, @Query() q: any) {
        const rs = await this.svc.list({
            q: q.q,
            status: q.status,
            deptId: q.deptId,
            page: Number(q.page),
            limit: Number(q.size ?? q.limit),
        })
        return paged(rs.items, rs.page, rs.limit, rs.total, 'OK', getReqId(req))
    }

    @Post()
    async create(@Req() req: Request, @Body() dto: CreateEmployeeDto) {
        const emp = await this.svc.create(dto)
        return created(emp, 'Created', getReqId(req))
    }

    @Get('roles')
    async getByRoles(@Req() req: Request, @Query('roles') roles?: string) {
        const parsed = (roles ?? '')
            .split(',')
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .filter((s) => ['manager', 'director', 'vp', 'lead'].includes(s)) as any

        const items = await this.svc.listByRoles(parsed.length ? parsed : undefined)
        return success(items, 'OK', 200, getReqId(req))
    }
}
