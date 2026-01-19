import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'
import { QueueFactory } from 'src/infra/queue/queue.factory'
import { CronRouterService } from './cron-router.service'

@Injectable()
export class CronListener implements OnApplicationBootstrap {
    private readonly logger = new Logger(CronListener.name)

    constructor(
        private readonly qf: QueueFactory,
        private readonly router: CronRouterService,
    ) {}

    // onModuleInit() {
    //     this.qf.createWorker('cron', async (job) => {
    //         this.logger.log(`GOT job name=${job.name} id=${job.id}`)
    //         await this.router.dispatch(job)
    //     })
    //     this.logger.log('Listening queue=cron')
    // }

    onApplicationBootstrap() {
        this.qf.createWorker('cron', async (job) => {
            this.logger.log(`GOT job name=${job.name} id=${job.id}`)
            await this.router.dispatch(job)
        })
        this.logger.log('🚀 Worker listening queue=cron')
    }
}
