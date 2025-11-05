import { Body, Controller, Delete, Get, Param, Post, Query, UseInterceptors } from '@nestjs/common'
import { ContractsService } from './contracts.service'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { MODULE_CODES } from 'src/common/constants/modules'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'

@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CONTRACT)
@Controller('contracts')
export class ContractsController {
    constructor(private readonly service: ContractsService) {}

    @Get()
    list(@Query() query: ContractListQueryDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.findOne(id)
    }

    @Post()
    create(@Body() dto: CreateContractDto) {
        return this.service.create(dto)
    }

    @Post(':id')
    update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.softDelete(id)
    }

    @Post('generate-code')
    generateCode(@Body('customerId') customerId: string) {
        return this.service.generateCode(customerId)
    }
}
