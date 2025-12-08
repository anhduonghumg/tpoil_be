import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards, UseInterceptors } from '@nestjs/common'
import { ContractsService } from './contracts.service'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { MODULE_CODES } from 'src/common/constants/modules'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
// import { success } from 'src/common/http/http.response.util'

import type { Response } from 'express'
import { ContractExpiryEmailDto } from './dto/contract-expiry-email.dto'
import { success } from 'src/common/http/http.response.util'
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'
const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
@UseInterceptors(AuditInterceptor)
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
        return this.service.getContractExpiryList(query)
    }

    @Get('expiry-report/export')
    async exportExpiryReport(@Query() query: any, @Res() res: Response) {
        const { referenceDate, status } = query

        const { buffer } = await this.service.generateContractExpiryExcel({
            referenceDate,
            status,
        })

        const filename = `contract-expiry-${referenceDate || 'today'}.xlsx`

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)

        return res.send(buffer)
    }

    @Post('expiry-report/resend-email')
    resendExpiryEmail(@Body() body: ContractExpiryEmailDto) {
        return this.service.sendContractExpiryEmail(body)
    }

    @Get('attachable')
    getAttachableContracts(@Query('customerId') customerId: string, @Query('keyword') keyword?: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
        return this.service.listAttachableContracts({
            customerId,
            keyword,
            page: +page || 1,
            pageSize: +pageSize || 20,
        })
    }

    @Post('attachments')
    createAttachment(@Body() dto: CreateContractAttachmentDto) {
        return this.service.createAttachment(dto)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateContractDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.remove(id)
    }

    @Get(':id/contracts')
    async getCustomerContracts(@Param('id') id: string, @Req() req: Request) {
        const contracts = await this.service.listByCustomer(id)
        return success(contracts, 'OK', 200, getReqId(req))
    }
}

// @Post('generate-code')
// async generateCode(@Body('customerId') customerId: string, @Req() req: Request) {
//     const rs = await this.service.generateCode(customerId)
//     return success(rs, 'OK', 200, getReqId(req))
// }
