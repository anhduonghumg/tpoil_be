// src/common/filters/prisma-exception.filter.ts
import { ArgumentsHost, Catch, ConflictException, ExceptionFilter } from '@nestjs/common'
import { Prisma } from '@prisma/client'

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
    catch(e: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
        if (e.code === 'P2002') {
            const target = e.meta?.target as string[] | string | undefined
            const fields = Array.isArray(target) ? target : target ? [target] : []
            throw new ConflictException({
                code: 'CONFLICT',
                message: `Trùng dữ liệu tại: ${fields.join(', ') || 'unknown'}`,
                details: { fields },
            })
        }
        throw e
    }
}
