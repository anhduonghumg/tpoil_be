import { Controller, Get, Post, Put, Delete, Body, Param } from '@nestjs/common'
import { ContractAttachmentsService } from './contract-attachments.service'
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'
import { UpdateContractAttachmentDto } from './dto/update-contract-attachment.dto'

@Controller('contract-attachments')
export class ContractAttachmentsController {
    constructor(private readonly service: ContractAttachmentsService) {}

    @Get('contract/:id')
    list(@Param('id') contractId: string) {
        return this.service.listByContract(contractId)
    }

    @Post()
    create(@Body() dto: CreateContractAttachmentDto) {
        return this.service.create(dto)
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateContractAttachmentDto) {
        return this.service.update(id, dto)
    }

    @Delete(':id')
    delete(@Param('id') id: string) {
        return this.service.delete(id)
    }
}
