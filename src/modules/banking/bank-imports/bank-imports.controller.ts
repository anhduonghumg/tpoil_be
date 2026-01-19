import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { BankImportsService } from './bank-imports.service'
import { CreateBankImportDto } from './dto/create-bank-import.dto'

@Controller('bank-imports')
export class BankImportsController {
    constructor(private readonly service: BankImportsService) {}

    @Post()
    create(@Body() dto: CreateBankImportDto) {
        return this.service.createAndMaybeProcess(dto)
    }

    @Post(':id/process-sync')
    processSync(@Param('id') id: string) {
        return this.service.processSync(id)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }
}
