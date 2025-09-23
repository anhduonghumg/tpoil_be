import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseInterceptors } from '@nestjs/common'
import { DepartmentsService } from './departments.service'
import { CreateDepartmentDto } from './dto/create-department.dto'
import { UpdateDepartmentDto } from './dto/update-department.dto'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { MODULE_CODES } from 'src/common/constants/modules'
import { ModuleName } from 'src/common/decorators/module-name.decorator'

@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.DEPARTMENT)
@Controller('departments')
export class DepartmentsController {
    constructor(private readonly svc: DepartmentsService) {}
    @Post()
    create(@Body() dto: CreateDepartmentDto) {
        return this.svc.create(dto)
    }

    @Get()
    list(@Query() q: any) {
        return this.svc.findMany(q)
    }

    @Get('sites')
    sites() {
        return this.svc.listSites()
    }

    @Get('tree')
    tree(@Query('rootId') rootId?: string) {
        if (!rootId) return this.svc.findTree()
        return this.svc.findTree(rootId)
    }

    @Get(':id')
    get(@Param('id') id: string) {
        if (!id) return
        return this.svc.findOne(id)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateDepartmentDto) {
        if (!id) return 'Lỗi rồi'
        return this.svc.update(id, dto)
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        if (!id) return
        return this.svc.remove(id)
    }
}
