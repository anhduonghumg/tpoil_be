// src/modules/app/app.controller.ts
import { Controller, Get, UseGuards } from '@nestjs/common'
import { AppBootstrapService } from './app-bootstrap.service'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'

@Controller('app')
@UseGuards(LoggedInGuard)
export class AppController {
    constructor(private readonly appBootstrapService: AppBootstrapService) {}

    @Get('bootstrap')
    async bootstrap() {
        return this.appBootstrapService.bootstrap()
    }
}
