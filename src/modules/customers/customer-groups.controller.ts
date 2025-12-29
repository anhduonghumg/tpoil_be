import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Request } from 'express'
import type { CustomerGroup } from '@prisma/client'
import { paged, success } from 'src/common/http/http.response.util'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { MODULE_CODES } from 'src/common/constants/modules'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { CustomerGroupsService } from './customer-groups.service'
import { CustomerGroupListQueryDto } from './dto/customer-group-list-query.dto'
import { CustomerGroupSelectQueryDto } from './dto/customer-group-select-query.dto'
import { CreateCustomerGroupDto } from './dto/create-customer-group.dto'
import { UpdateCustomerGroupDto } from './dto/update-customer-group.dto'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CUSTOMER)
@Controller('customer-groups')
export class CustomerGroupsController {
    constructor(private readonly service: CustomerGroupsService) {}

    @Get()
    async list(@Query() q: CustomerGroupListQueryDto, @Req() req: Request) {
        const rs = await this.service.list(q)
        return paged(rs.items, rs.page, rs.pageSize, rs.total, 'OK', getReqId(req))
    }

    @Get('select')
    async select(@Query() q: CustomerGroupSelectQueryDto, @Req() req: Request) {
        const rs = await this.service.select(q)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Get(':id')
    async detail(@Param('id') id: string, @Req() req: Request) {
        const rs: CustomerGroup = await this.service.detail(id)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Post()
    async create(@Body() dto: CreateCustomerGroupDto, @Req() req: Request) {
        const rs: CustomerGroup = await this.service.create(dto)
        return success(rs, 'Created', 201, getReqId(req))
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateCustomerGroupDto, @Req() req: Request) {
        const rs: CustomerGroup = await this.service.update(id, dto)
        return success(rs, 'Updated', 200, getReqId(req))
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Req() req: Request) {
        const rs: CustomerGroup = await this.service.remove(id)
        return success(rs, 'Deleted', 200, getReqId(req))
    }
}
