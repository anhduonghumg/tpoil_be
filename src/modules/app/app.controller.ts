// src/modules/app/app.controller.ts
import { Controller, Get, Req, UseGuards } from '@nestjs/common'
import { AppBootstrapService } from './app-bootstrap.service'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'

@Controller('app')
@UseGuards(LoggedInGuard)
export class AppController {
    constructor(private readonly appBootstrapService: AppBootstrapService) {}

    @Get('bootstrap')
    async bootstrap(@Req() req) {
        return this.appBootstrapService.bootstrap(req.session?.auth)
    }
}
