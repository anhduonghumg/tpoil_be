import { Controller, Get, Query } from '@nestjs/common'
// import { success } from 'src/common/http/http.response.util'
import { PrismaService } from 'src/infra/prisma/prisma.service'

// const getReqId = (req: Request) => (req.headers['x-request-id'] as string) || (req as any).requestId

@Controller('lookups')
export class LookupsController {
    constructor(private readonly prisma: PrismaService) {}

    @Get('contract-types')
    async getContractTypes(@Query('activeOnly') activeOnly?: string) {
        const where = activeOnly === 'true' ? { isActive: true } : {}
        const list = await this.prisma.contractType.findMany({
            where,
            orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
            select: { id: true, code: true, name: true },
        })
        // console.log('list', list)
        return list
    }
}
