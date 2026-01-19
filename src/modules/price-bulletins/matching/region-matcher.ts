// src/modules/price-bulletins/matching/region-matcher.ts
import { Injectable } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'

function normalize(input: string) {
    return String(input ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim()
}

@Injectable()
export class RegionMatcher {
    private loaded = false
    private byCode = new Map<string, { id: string; code: string; name: string }>()
    private byName = new Map<string, { id: string; code: string; name: string }>()

    constructor(private readonly prisma: PrismaService) {}

    async warmup() {
        if (this.loaded) return
        const rows = await this.prisma.priceRegion.findMany({ where: { isActive: true }, select: { id: true, code: true, name: true } })
        for (const r of rows) {
            this.byCode.set(normalize(r.code), r)
            this.byName.set(normalize(r.name), r)
            this.byName.set(normalize(r.name).replace('VUNG', 'VUNG'), r)
        }
        this.loaded = true
    }

    async findByCodeOrName(input: string) {
        await this.warmup()
        const key = normalize(input)
        return this.byCode.get(key) ?? this.byName.get(key) ?? null
    }
}
