// src/modules/job-artifacts/job-artifacts.service.ts
import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'

type JsonValue = Prisma.InputJsonValue

function toJsonValue(v: unknown): JsonValue | undefined {
    if (v === undefined) return undefined
    try {
        return JSON.parse(JSON.stringify(v)) as JsonValue
    } catch {
        return String(v) as unknown as JsonValue
    }
}

@Injectable()
export class JobArtifactsService {
    constructor(private readonly prisma: PrismaService) {}

    async upsertArtifact(args: { runId: string; kind: string; content?: unknown; fileUrl?: string; checksum?: string }) {
        const existing = await this.prisma.jobArtifact.findFirst({ where: { runId: args.runId, kind: args.kind } })
        if (existing) {
            return this.prisma.jobArtifact.update({
                where: { id: existing.id },
                data: {
                    content: toJsonValue(args.content),
                    fileUrl: args.fileUrl ?? null,
                    checksum: args.checksum ?? null,
                },
            })
        }

        return this.prisma.jobArtifact.create({
            data: {
                runId: args.runId,
                kind: args.kind,
                storage: 'DB',
                content: toJsonValue(args.content),
                fileUrl: args.fileUrl ?? null,
                checksum: args.checksum ?? null,
            },
        })
    }

    async getArtifact(runId: string, kind: string) {
        return this.prisma.jobArtifact.findFirst({
            where: { runId, kind },
            select: { id: true, runId: true, kind: true, storage: true, content: true, fileUrl: true, checksum: true, createdAt: true },
        })
    }

    async deleteArtifact(runId: string, kind: string) {
        await this.prisma.jobArtifact.deleteMany({ where: { runId, kind } })
    }
}
