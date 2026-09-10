import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { ContractAppendicesService } from './contract-appendices.service'
import { UpsertContractAppendixDto } from './dto/contract-appendix.dto'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'

@UseGuards(LoggedInGuard)
@Controller('contracts/:contractId/appendices')
export class ContractAppendicesController {
    constructor(private readonly service: ContractAppendicesService) {}

    @Get()
    list(@Param('contractId') contractId: string) {
        return this.service.list(contractId)
    }

    /**
     * Điều khoản đang áp tại một ngày (mặc định hôm nay) sau khi chồng các phụ lục.
     * Dùng để xem trước giá sàn sẽ được chấm cho một đơn có ngày cụ thể.
     */
    @Get('terms')
    termsAt(@Param('contractId') contractId: string, @Query('at') at?: string) {
        return this.service.termsAt(contractId, at)
    }

    @Post()
    create(@Param('contractId') contractId: string, @Body() dto: UpsertContractAppendixDto) {
        return this.service.create(contractId, dto)
    }

    @Patch(':appendixId')
    update(
        @Param('contractId') contractId: string,
        @Param('appendixId') appendixId: string,
        @Body() dto: UpsertContractAppendixDto,
    ) {
        return this.service.update(contractId, appendixId, dto)
    }

    @Delete(':appendixId')
    remove(@Param('contractId') contractId: string, @Param('appendixId') appendixId: string) {
        return this.service.remove(contractId, appendixId)
    }
}
