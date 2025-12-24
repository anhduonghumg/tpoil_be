// customers/customer-addresses.controller.ts
import { Controller, Get, Post, Patch, Delete, Param, Body, Req, UseGuards, UseInterceptors } from '@nestjs/common'
import type { Request } from 'express'
import type { CustomerAddress } from '@prisma/client'
import { success } from 'src/common/http/http.response.util'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { AuditInterceptor } from 'src/audit/audit.interceptor'
import { ModuleName } from 'src/common/decorators/module-name.decorator'
import { MODULE_CODES } from 'src/common/constants/modules'
import { CustomerAddressesService } from './customer-addresses.service'
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto'
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@UseGuards(LoggedInGuard)
@UseInterceptors(AuditInterceptor)
@ModuleName(MODULE_CODES.CUSTOMER)
@Controller('customers/:customerId/addresses')
export class CustomerAddressesController {
    constructor(private readonly service: CustomerAddressesService) {}

    @Get()
    async list(@Param('customerId') customerId: string, @Req() req: Request) {
        const rs: CustomerAddress[] = await this.service.list(customerId)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Post()
    async create(@Param('customerId') customerId: string, @Body() dto: CreateCustomerAddressDto, @Req() req: Request) {
        const rs: CustomerAddress = await this.service.create(customerId, dto)
        return success(rs, 'Created', 201, getReqId(req))
    }

    @Patch(':addressId')
    async update(@Param('addressId') addressId: string, @Body() dto: UpdateCustomerAddressDto, @Req() req: Request) {
        const rs: CustomerAddress = await this.service.update(addressId, dto)
        return success(rs, 'Updated', 200, getReqId(req))
    }

    @Delete(':addressId')
    async remove(@Param('addressId') addressId: string, @Req() req: Request) {
        const rs: CustomerAddress = await this.service.remove(addressId)
        return success(rs, 'Deleted', 200, getReqId(req))
    }
}
