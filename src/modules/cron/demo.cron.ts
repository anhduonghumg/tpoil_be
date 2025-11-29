import { Injectable } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { CronRunnerService } from './cron-runner.service'
import { CronJobType } from '@prisma/client'

function truncateToDate(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

@Injectable()
export class DemoCron {
    constructor(private readonly cronRunner: CronRunnerService) {}

    // @Cron(CronExpression.EVERY_MINUTE, {
    //     timeZone: 'Asia/Ho_Chi_Minh',
    // })
    // async handleDemo() {
    //     const today = truncateToDate(new Date())

    //     await this.cronRunner.runJob('CONTRACT_EXPIRY_DAILY', today, async () => {
    //         // === Handler demo ===
    //         // giả lập xử lý 0.5s
    //         await new Promise((resolve) => setTimeout(resolve, 500))

    //         // metrics demo, sau này job thật trả về cái của nó
    //         return {
    //             demo: true,
    //             ranAt: new Date().toISOString(),
    //         }
    //     })
    // }
}
