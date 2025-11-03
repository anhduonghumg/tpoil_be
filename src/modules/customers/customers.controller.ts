import { Controller, Get, Post, Patch, Delete, Param, Body, Query, Req } from '@nestjs/common'
import { CustomersService } from './customers.service'
import { CreateCustomerDto } from './dto/create-customer.dto'
import { UpdateCustomerDto } from './dto/update-customer.dto'
import { QueryCustomerDto } from './dto/query-customer.dto'
import { paged, success } from 'src/common/http/http.response.util'

const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@Controller('customers')
export class CustomersController {
    constructor(private readonly service: CustomersService) {}
    @Get()
    async list(@Req() req: Request, @Query() q: QueryCustomerDto) {
        const rs = await this.service.findAll(q)
        return paged(rs.items, rs.page, rs.pageSize, rs.total, 'OK', getReqId(req))
    }

    @Get(':id')
    async findOne(@Param('id') id: string, @Req() req: Request) {
        const rs = await this.service.findOne(id)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Post()
    async create(@Body() body: CreateCustomerDto, @Req() req: Request) {
        const rs = await this.service.create(body)
        return success(rs, 'Created', 201, getReqId(req))
    }

    @Patch(':id')
    async update(@Param('id') id: string, @Body() body: UpdateCustomerDto, @Req() req: Request) {
        const rs = await this.service.update(id, body)
        return success(rs, 'Updated', 200, getReqId(req))
    }

    @Delete(':id')
    async remove(@Param('id') id: string, @Req() req: Request) {
        const rs = await this.service.softDelete(id)
        return success(rs, 'Deleted', 200, getReqId(req))
    }

    // Nút “Tạo tự động” (trả code hoặc ghi trực tiếp nếu có id)
    @Post(':id/generate-code')
    async genForId(@Param('id') id: string, @Req() req: Request) {
        const rs = await this.service.generateCode(id)
        return success(rs, 'OK', 200, getReqId(req))
    }

    @Post('generate-code')
    async gen(@Req() req: Request) {
        const rs = await this.service.generateCode()
        return success(rs, 'OK', 200, getReqId(req))
    }
}
