import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { CommercialRetailService } from './commercial-retail.service'
import { ListCommercialRetailQueryDto } from './dto/commercial-retail.dto'

@UseGuards(LoggedInGuard)
@Controller('commercial-retail-purchases')
export class CommercialRetailController {
    constructor(private readonly service: CommercialRetailService) {}

    @Get()
    list(@Query() query: ListCommercialRetailQueryDto) {
        return this.service.list(query)
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }
}
