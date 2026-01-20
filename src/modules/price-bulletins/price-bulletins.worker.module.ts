import { Module } from '@nestjs/common'
import { PriceBulletinsService } from './price-bulletins.service'
import { PriceBulletinProcessor } from './jobs/price-bulletin.processor'
import { BackgroundJobsModule } from '../background-jobs/background-jobs.module'
import { JobArtifactsModule } from '../job-artifacts/job-artifacts.module'
import { PricePdfStorage } from './price-file.storage'
import { ProductMatcher } from './matching/product-matcher'
import { RegionMatcher } from './matching/region-matcher'
import { PrismaModule } from 'src/infra/prisma/prisma.module'
import { QueueModule } from 'src/infra/queue/queue.module'
import { PriceBulletinWorker } from './price-bulletin-worker.listener'

@Module({
    imports: [PrismaModule, BackgroundJobsModule, JobArtifactsModule, QueueModule],
    providers: [PriceBulletinsService, PricePdfStorage, ProductMatcher, RegionMatcher, PriceBulletinProcessor, PriceBulletinWorker],
})
export class PriceBulletinsWorkerModule {}
