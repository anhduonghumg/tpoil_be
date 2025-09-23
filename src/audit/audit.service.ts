/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common'
import { ScopeType } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { v7 as uuidv7 } from 'uuid'

export type AuditInput = {
    requestId?: string
    userId?: string | null
    ip?: string
    ua?: string
    method: string
    path: string
    statusCode: number

    moduleCode: string
    permission?: string
    action: string
    entityId?: string

    scopeType?: ScopeType
    scopeId?: string | null

    before?: unknown
    after?: unknown
    diff?: unknown
    error?: unknown
}

@Injectable()
export class AuditService {
    constructor(private readonly prisma: PrismaService) {}

    async write(entry: AuditInput) {
        await this.prisma.auditLog.create({
            data: {
                id: uuidv7(),
                requestId: entry.requestId ?? null,
                userId: entry.userId ?? null,
                ip: entry.ip ?? null,
                ua: entry.ua ?? null,
                method: entry.method,
                path: entry.path,
                statusCode: entry.statusCode,

                moduleCode: entry.moduleCode,
                permission: entry.permission ?? null,
                action: entry.action,
                entityId: entry.entityId ?? null,
                scopeType: entry.scopeType ?? null,
                scopeId: entry.scopeId ?? null,

                before: entry.before as any,
                after: entry.after as any,
                diff: entry.diff as any,
                error: entry.error as any,
            },
        })
    }
}
