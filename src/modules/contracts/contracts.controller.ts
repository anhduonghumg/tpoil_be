import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards, UseInterceptors } from '@nestjs/common'
import { ContractsService } from './contracts.service'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { MODULE_CODES } from 'src/common/constants/modules'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
// import { success } from 'src/common/http/http.response.util'

// const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

// @UseGuards(LoggedInGuard)
// @UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CONTRACT)
@Controller('contracts')
export class ContractsController {
    constructor(private readonly service: ContractsService) {}

    @Get()
    list(@Query() query: ContractListQueryDto) {
        return this.service.list(query)
    }

    @Post()
    create(@Body() dto: CreateContractDto) {
        return this.service.create(dto)
    }

    @Get('expiry-counts')
    getExpiryCounts() {
        return this.service.getContractExpiryCounts()
    }

    // contracts.controller.ts
    @Get('expiry-report')
    getExpiryReport(@Query() query: any) {
        return this.service.getContractExpiryList()
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
        // console.log('Updating contract with ID:', id, 'using DTO:', dto)
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.remove(id)
    }
}

// @Post('generate-code')
// async generateCode(@Body('customerId') customerId: string, @Req() req: Request) {
//     const rs = await this.service.generateCode(customerId)
//     return success(rs, 'OK', 200, getReqId(req))
// }
