import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common'

import { BankPurposesService } from './bank-purposes.service'
import { BankPurposeQueryDto } from './dto/bank-purpose-query.dto'
import { CreateBankPurposeDto } from './dto/create-bank-purpose.dto'
import { UpdateBankPurposeDto } from './dto/update-bank-purpose.dto'

@Controller('bank/purposes')
export class BankPurposesController {
    constructor(private readonly service: BankPurposesService) {}

    @Get()
    list(@Query() query: BankPurposeQueryDto) {
        return this.service.list(query)
    }

    @Get('all')
    all() {
        return this.service.all()
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateBankPurposeDto) {
        return this.service.create(dto)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() dto: UpdateBankPurposeDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.service.remove(id)
    }
}
