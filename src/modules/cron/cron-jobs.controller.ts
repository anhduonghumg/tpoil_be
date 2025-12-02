import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common'
import { CronJobsService } from './cron-jobs.service'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'

@UseGuards(LoggedInGuard)
@Controller('cron-jobs')
export class CronJobsController {
    constructor(private readonly service: CronJobsService) {}

    @Get()
    listJobs() {
        return this.service.listJobs()
    }

    @Get(':id/runs')
    listRuns(@Param('id') id: string, @Query('page') page = '1', @Query('pageSize') pageSize = '20') {
        return this.service.listRunsByJob(id, Number.isNaN(+page) ? 1 : +page, Number.isNaN(+pageSize) ? 20 : +pageSize)
    }
}
