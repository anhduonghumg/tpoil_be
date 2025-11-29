import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import { ContractTypesService } from './contract-types.service'
import { ContractTypeListQueryDto } from './dto/contract-type-list-query.dto'
import { CreateContractTypeDto } from './dto/create-contract-type.dto'
import { UpdateContractTypeDto } from './dto/update-contract-type.dto'
import { paged, success } from 'src/common/http/http.response.util'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { MODULE_CODES } from 'src/common/constants/modules'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CONTRACTTYPE)
@Controller('contract-types')
export class ContractTypesController {
    constructor(private readonly service: ContractTypesService) {}

    @Get()
    async list(@Req() req: Request, @Query() query: ContractTypeListQueryDto) {
        const rs = await this.service.list(query)
        return paged(rs.items, rs.page, rs.pageSize, rs.total, 'OK', getReqId(req))
    }

    @Get(':id')
    async detail(@Req() req: Request, @Param('id') id: string) {
        const result = await this.service.findOne(id)
        return success(result, 'OK', 200, getReqId(req))
    }

    @Get('all')
    async all(@Req() req: Request) {
        const result = await this.service.getAll()
        return success(result, 'OK', 200, getReqId(req))
    }

    @Post()
    async create(@Req() req: Request, @Body() dto: CreateContractTypeDto) {
        const result = await this.service.create(dto)
        return success(result, 'OK', 200, getReqId(req))
    }

    @Patch(':id')
    async update(@Req() req: Request, @Param('id') id: string, @Body() dto: UpdateContractTypeDto) {
        const rs = await this.service.update(id, dto)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Delete(':id')
    async delete(@Req() req: Request, @Param('id') id: string) {
        const rs = await this.service.delete(id)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Post('delete-multiple')
    async deleteMultiple(@Req() req: Request, @Body('ids') ids: string[]) {
        const rs = await this.service.deleteMultiple(ids)
        return success(rs, 'OK', 200, getReqId(req))
    }
}
