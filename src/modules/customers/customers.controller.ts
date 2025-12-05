import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req, UseInterceptors, UseGuards } from '@nestjs/common'
import { CustomerListQueryDto } from './dto/customer-list-query.dto'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { paged, success } from 'src/common/http/http.response.util'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { MODULE_CODES } from 'src/common/constants/modules'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { CustomersService } from './customers.service'
import { CustomerOverviewService } from './customer-overview.service'
import { ContractsService } from '../contracts/contracts.service'
import { AssignContractsToCustomerDto } from './dto/assign-contracts.dto'
import { CustomerSelectQueryDto } from './dto/customer-select-query.dto'
import { UnassignContractsDto } from './dto/unassign-contracts.dto'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CUSTOMER)
@Controller('customers')
export class CustomersController {
    constructor(
        private readonly customersService: CustomersService,
        private readonly customerOverviewService: CustomerOverviewService,
        private readonly contractsService: ContractsService,
    ) {}
    @Get()
    async list(@Req() req: Request, @Query() q: CustomerListQueryDto) {
        const rs = await this.customersService.list(q)
        return paged(rs.items, rs.page, rs.pageSize, rs.total, 'OK', getReqId(req))
    }

    @Post()
    async create(@Body() dto: CreateCustomerDto, @Req() req: Request) {
        const rs = await this.customersService.create(dto)
        return success(rs, 'Created', 201, getReqId(req))
    }

    @Get('select')
    async select(@Query() query: CustomerSelectQueryDto, @Req() req: Request) {
        const rs = await this.customersService.select(query)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Get('generate-code')
    async generateCode(@Req() req: Request) {
        const rs = await this.customersService.generateCode()
        return success(rs, 'ok', 200, getReqId(req))
    }

    @Get(':id')
    async findOne(@Param('id') id: string, @Req() req: Request) {
        const rs = await this.customersService.detail(id)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateCustomerDto, @Req() req: Request) {
        const rs = await this.customersService.update(id, dto)
        return success(rs, 'Updated', 200, getReqId(req))
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Req() req: Request) {
        const rs = await this.customersService.remove(id)
        return success(rs, 'Deleted', 200, getReqId(req))
    }

    // ---- Assign / Unassign Contracts ----

    @Post(':id/contracts/assign')
    async assignContracts(@Param('id') customerId: string, @Body() dto: AssignContractsToCustomerDto, @Req() req: Request) {
        const rs = await this.contractsService.assignContractsToCustomer(customerId, dto)
        return success(rs, 'Created', 200, getReqId(req))
    }

    @Post(':id/contracts/unassign')
    async unassignContracts(@Param('id') id: string, @Body() dto: { contractIds: string[] }, @Req() req: Request) {
        const rs = await this.contractsService.unassignContractsFromCustomer(id, dto.contractIds)
        return success(rs, 'Created', 200, getReqId(req))
    }

    // ---- Overview ----

    @Get(':id/overview')
    async getOverview(@Param('id') customerId: string, @Req() req: Request) {
        const rs = await this.customerOverviewService.getOverview(customerId)
        return success(rs, 'success', 200, getReqId(req))
    }

    // Nút “Tạo tự động” (trả code hoặc ghi trực tiếp nếu có id)
    // @Post(':id/generate-code')
    // async genForId(@Param('id') id: string, @Req() req: Request) {
    //     const rs = await this.service.generateCode(id)
    //     return success(rs, 'OK', 200, getReqId(req))
    // }

    // @Post('generate-code')
    // async gen(@Req() req: Request) {
    //     const rs = await this.service.generateCode()
    //     return success(rs, 'OK', 200, getReqId(req))
    // }
}
