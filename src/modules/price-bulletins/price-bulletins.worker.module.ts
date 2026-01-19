import { Module } from '@nestjs/common'
import { PriceBulletinsService } from './price-bulletins.service'
import { PriceBulletinProcessor } from './jobs/price-bulletin.processor'
import { BackgroundJobsModule } from '../background-jobs/background-jobs.module'
import { JobArtifactsModule } from '../job-artifacts/job-artifacts.module'
import { PricePdfStorage } from './price-file.storage'
import { ProductMatcher } from './matching/product-matcher'
import { RegionMatcher } from './matching/region-matcher'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule, BackgroundJobsModule, JobArtifactsModule],
    providers: [PriceBulletinsService, PricePdfStorage, ProductMatcher, RegionMatcher, PriceBulletinProcessor],
})
export class PriceBulletinsWorkerModule {}
