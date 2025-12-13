import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import { EmployeesService } from './employees.service'
import { MODULE_CODES } from 'src/common/constants/modules'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { CreateEmployeeDto } from './dto/create-employee.dto'
import { created, paged, success } from 'src/common/http/http.response.util'
import { UpdateEmployeeDto } from './dto/update-employee.dto'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
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
            sortBy: q.sortBy,
            sortDir: q.sortDir,
            page: Number(q.page),
            limit: Number(q.size ?? q.limit),
        })
        return paged(rs.items, rs.page, rs.limit, rs.total, 'OK', getReqId(req))
    }

    @Get('select')
    select(@Query('keyword') keyword?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
        return this.svc.select({
            keyword: keyword?.trim(),
            page: Number(page ?? 1),
            pageSize: Number(pageSize ?? 50),
        })
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

    @Get('birthdays')
    async birthdays(@Query('month') month?: string) {
        const m = month ? Math.min(12, Math.max(1, Number(month))) : undefined
        const data = await this.svc.birthdays(m)
        return success(data, 'OK', 200)
    }

    @Post()
    async create(@Req() req: Request, @Body() dto: CreateEmployeeDto) {
        const emp = await this.svc.create(dto)
        return created(emp, 'Created', getReqId(req))
    }

    @Patch(':id')
    async update(@Req() req: Request, @Param('id') id: string, @Body() dto: Partial<UpdateEmployeeDto>) {
        // console.log('UpdateEmployeeDto', dto)
        const emp = await this.svc.update(id, dto)
        return success(emp, 'Updated', 200, getReqId(req))
    }

    @Delete(':id')
    async deleteOne(@Param('id') id: string) {
        const data = await this.svc.deleteOne(id)
        return success(data, 'Deleted', 200)
    }

    @Get(':id')
    async getById(@Req() req: Request, @Param('id') id: string) {
        const item = await this.svc.getById(id)
        return success(item, 'OK', 200, getReqId(req))
    }

    @Post('bulk-delete')
    async deleteMany(@Body('ids') ids: string[]) {
        const data = await this.svc.deleteMany(ids)
        return success(data, 'Deleted', 200)
    }
}
