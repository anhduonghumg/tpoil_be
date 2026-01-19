// src/modules/job-artifacts/job-artifacts.module.ts
import { Module } from '@nestjs/common'
import { JobArtifactsService } from './job-artifacts.service'

@Module({
    providers: [JobArtifactsService],
    exports: [JobArtifactsService],
})
export class JobArtifactsModule {}
