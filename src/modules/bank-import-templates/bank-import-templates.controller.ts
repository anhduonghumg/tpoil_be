import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common'
import { BankImportTemplatesService } from './bank-import-templates.service'
import { CreateBankImportTemplateDto } from './dto/create-bank-import-template.dto'
import { QueryBankImportTemplatesDto } from './dto/query-bank-import-templates.dto'
import { UpdateBankImportTemplateDto } from './dto/update-bank-import-template.dto'

@Controller('bank-import-templates')
export class BankImportTemplatesController {
    constructor(private readonly service: BankImportTemplatesService) {}

    @Get()
    list(@Query() query: QueryBankImportTemplatesDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() body: CreateBankImportTemplateDto) {
        return this.service.create(body)
    }

    @Patch(':id')
    update(@Param('id') id: string, @Body() body: UpdateBankImportTemplateDto) {
        return this.service.update(id, body)
    }
}
