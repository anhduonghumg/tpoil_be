import { Module } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { SessionService } from './session.service'

@Module({
    providers: [SessionService, PrismaService],
    exports: [SessionService],
})
export class SessionModule {}
