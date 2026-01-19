import { Module } from '@nestjs/common'
import { PriceBulletinsController } from './price-bulletins.controller'
import { PriceBulletinsService } from './price-bulletins.service'
import { BackgroundJobsModule } from '../background-jobs/background-jobs.module'
import { JobArtifactsModule } from '../job-artifacts/job-artifacts.module'
import { PricePdfStorage } from './price-file.storage'
import { ProductMatcher } from './matching/product-matcher'
import { RegionMatcher } from './matching/region-matcher'
import { PrismaModule } from 'src/infra/prisma/prisma.module'

@Module({
    imports: [PrismaModule, BackgroundJobsModule, JobArtifactsModule],
    controllers: [PriceBulletinsController],
    providers: [PriceBulletinsService, PricePdfStorage, ProductMatcher, RegionMatcher],
    exports: [PriceBulletinsService],
})
export class PriceBulletinsModule {}
