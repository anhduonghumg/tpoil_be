import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class SessionService {
    constructor(private readonly prisma: PrismaService) {}

    async deleteSessionsByUserId(userId: string): Promise<number> {
        const result = await this.prisma.$executeRawUnsafe<number>(
            `
      DELETE FROM "session"
      WHERE sess::json->'auth'->>'userId' = $1
         OR sess::json->'passport'->>'user' = $1
      `,
            userId,
        )

        return result ?? 0
    }
}
