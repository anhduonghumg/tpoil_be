import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { CreateBankAccountDto } from './dto/create-bank-account.dto'
import { QueryBankAccountsDto } from './dto/query-bank-accounts.dto'
import { UpdateBankAccountDto } from './dto/update-bank-account.dto'
import { BankAccountsService } from './bank-accounts.service'

@Controller('bank-accounts')
export class BankAccountsController {
    constructor(private readonly service: BankAccountsService) {}

    @Get()
    list(@Query() query: QueryBankAccountsDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() body: CreateBankAccountDto) {
        return this.service.create(body)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() body: UpdateBankAccountDto) {
        return this.service.update(id, body)
    }
}
