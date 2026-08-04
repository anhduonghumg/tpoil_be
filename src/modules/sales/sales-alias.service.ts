import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SalesAliasEntityType, SalesAliasSource } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CreateAliasDto,
    ImportAliasDto,
    ListAliasQueryDto,
    UpdateAliasDto,
} from './dto/sales-alias.dto'

export type AliasCandidate = {
    id: string
    code: string | null
    name: string
    score: number
    matchedBy: 'alias' | 'code' | 'name' | 'compact' | 'initials' | 'partial'
}

export type AliasMatch =
    | { ok: true; entityId: string; matchedBy: AliasCandidate['matchedBy']; confidence: number; canonicalKey: string }
    | { ok: false; reason: 'NOT_FOUND' | 'AMBIGUOUS'; canonicalKey: string; candidates: AliasCandidate[] }

type EntityRow = { id: string; code: string | null; name: string }

/**
 * One normalisation for every alias lookup.
 *
 * Built from what the spreadsheet actually contains: trailing spaces ("Nghi son "), a
 * leading "Kho:" or "Kho :", stray punctuation, mixed case, and the same spelling written
 * with and without diacritics. Everything collapses to letters and digits so
 * "Kho: Hải Linh HP", "hai linh hp" and "HaiLinhHP" all land on the same key.
 */
export function normalizeAlias(input: string) {
    return String(input ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toUpperCase()
        // Drop a leading document word so "Kho: Hải Linh" and "Hải Linh" agree.
        .replace(/^\s*KHO\s*:?\s*/u, '')
        .replace(/[^A-Z0-9]+/g, '')
        .trim()
}

/** Initials of each word: "Hải Linh Hải Phòng" → "HLHP", which is how people write it. */
function initialsOf(name: string) {
    const words = String(name ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'D')
        .toUpperCase()
        .replace(/^\s*KHO\s*:?\s*/u, '')
        .split(/[^A-Z0-9]+/u)
        .filter(Boolean)
    return words.map((word) => word[0]).join('')
}

@Injectable()
export class SalesAliasService {
    constructor(private readonly prisma: PrismaService) {}

    private async entities(entityType: SalesAliasEntityType): Promise<EntityRow[]> {
        if (entityType === SalesAliasEntityType.PARTY) {
            return this.prisma.party.findMany({
                where: { deletedAt: null },
                select: { id: true, code: true, name: true },
            })
        }
        if (entityType === SalesAliasEntityType.WAREHOUSE) {
            return this.prisma.warehouse.findMany({ select: { id: true, code: true, name: true } })
        }
        return this.prisma.product.findMany({ select: { id: true, code: true, name: true } })
    }

    private entityIdOf(alias: { partyId: string | null; warehouseId: string | null; productId: string | null }) {
        return alias.partyId ?? alias.warehouseId ?? alias.productId!
    }

    private targetField(entityType: SalesAliasEntityType) {
        return entityType === SalesAliasEntityType.PARTY
            ? 'partyId'
            : entityType === SalesAliasEntityType.WAREHOUSE
              ? 'warehouseId'
              : 'productId'
    }

    /**
     * Resolves a spelling to one entity.
     *
     * The explicit alias table wins, because domain knowledge like "AP" meaning Kho Nghi Sơn
     * cannot be derived from the name. Only after that do we try the entity's own code and
     * name, then progressively looser shapes — and anything loose is offered as a candidate
     * rather than chosen, since picking the wrong customer or depot is far worse than asking.
     */
    async match(entityType: SalesAliasEntityType, rawText: string): Promise<AliasMatch> {
        const canonicalKey = normalizeAlias(rawText)
        if (!canonicalKey) {
            return { ok: false, reason: 'NOT_FOUND', canonicalKey, candidates: [] }
        }

        const [aliases, rows] = await Promise.all([
            this.prisma.salesEntityAlias.findMany({
                where: { entityType, validTo: null },
                select: { normalizedName: true, partyId: true, warehouseId: true, productId: true },
            }),
            this.entities(entityType),
        ])
        const byId = new Map(rows.map((row) => [row.id, row]))

        // 1) Explicit mapping maintained by the business.
        const aliasHits = [
            ...new Set(
                aliases
                    .filter((alias) => alias.normalizedName === canonicalKey)
                    .map((alias) => this.entityIdOf(alias)),
            ),
        ]
        if (aliasHits.length === 1) {
            return { ok: true, entityId: aliasHits[0], matchedBy: 'alias', confidence: 1, canonicalKey }
        }
        if (aliasHits.length > 1) {
            return {
                ok: false,
                reason: 'AMBIGUOUS',
                canonicalKey,
                candidates: aliasHits
                    .map((id) => byId.get(id))
                    .filter((row): row is EntityRow => !!row)
                    .map((row) => ({ ...row, score: 1, matchedBy: 'alias' as const })),
            }
        }

        // 2) The entity's own code, then its own name.
        const exact = (picker: (row: EntityRow) => string | null, matchedBy: AliasCandidate['matchedBy'], confidence: number) => {
            const hits = rows.filter((row) => normalizeAlias(picker(row) ?? '') === canonicalKey)
            if (hits.length === 1) {
                return { ok: true as const, entityId: hits[0].id, matchedBy, confidence, canonicalKey }
            }
            if (hits.length > 1) {
                return {
                    ok: false as const,
                    reason: 'AMBIGUOUS' as const,
                    canonicalKey,
                    candidates: hits.map((row) => ({ ...row, score: confidence, matchedBy })),
                }
            }
            return null
        }
        const byCode = exact((row) => row.code, 'code', 1)
        if (byCode) return byCode
        const byName = exact((row) => row.name, 'name', 0.95)
        if (byName) return byName

        // 3) Looser shapes — proposals only.
        const candidates: AliasCandidate[] = []
        for (const row of rows) {
            const nameKey = normalizeAlias(row.name)
            const codeKey = normalizeAlias(row.code ?? '')
            const initials = initialsOf(row.name)

            if (initials && initials === canonicalKey) {
                candidates.push({ ...row, score: 0.8, matchedBy: 'initials' })
                continue
            }
            if (nameKey && (nameKey.includes(canonicalKey) || canonicalKey.includes(nameKey))) {
                // Longer overlap means a safer guess.
                const overlap = Math.min(nameKey.length, canonicalKey.length)
                const score = Math.min(0.75, 0.4 + overlap / Math.max(nameKey.length, canonicalKey.length) / 2)
                candidates.push({ ...row, score, matchedBy: 'partial' })
                continue
            }
            if (codeKey && (codeKey.includes(canonicalKey) || canonicalKey.includes(codeKey))) {
                candidates.push({ ...row, score: 0.6, matchedBy: 'compact' })
            }
        }
        candidates.sort((a, b) => b.score - a.score)

        if (!candidates.length) {
            return { ok: false, reason: 'NOT_FOUND', canonicalKey, candidates: [] }
        }
        // A clear winner well ahead of the rest may be taken; otherwise the sale chooses.
        const [top, second] = candidates
        if (top.score >= 0.8 && (!second || top.score - second.score >= 0.15)) {
            return { ok: true, entityId: top.id, matchedBy: top.matchedBy, confidence: top.score, canonicalKey }
        }
        return { ok: false, reason: 'AMBIGUOUS', canonicalKey, candidates: candidates.slice(0, 5) }
    }

    // ===== Quản lý alias cho kinh doanh =====

    async list(query: ListAliasQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 50, 1), 200)
        const keyword = query.keyword?.trim()
        const where: Prisma.SalesEntityAliasWhereInput = {
            entityType: query.entityType ?? undefined,
            validTo: query.includeRetired ? undefined : null,
            source: query.source ?? undefined,
            ...(query.entityId
                ? {
                      OR: [
                          { partyId: query.entityId },
                          { warehouseId: query.entityId },
                          { productId: query.entityId },
                      ],
                  }
                : {}),
            ...(keyword
                ? {
                      OR: [
                          { externalName: { contains: keyword, mode: 'insensitive' } },
                          { normalizedName: { contains: normalizeAlias(keyword) } },
                      ],
                  }
                : {}),
        }
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.salesEntityAlias.findMany({
                where,
                include: {
                    party: { select: { id: true, code: true, name: true } },
                    warehouse: { select: { id: true, code: true, name: true } },
                    product: { select: { id: true, code: true, name: true } },
                },
                orderBy: [{ entityType: 'asc' }, { normalizedName: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesEntityAlias.count({ where }),
        ])
        return { items: rows, total, page, limit }
    }

    /** Adds several spellings for one entity in one go — business pastes lists, not lines. */
    async create(dto: CreateAliasDto, actor: ScopedActor) {
        const entity = (await this.entities(dto.entityType)).find((row) => row.id === dto.entityId)
        if (!entity) throw new NotFoundException('ALIAS_ENTITY_NOT_FOUND')

        const added: string[] = []
        const skipped: Array<{ alias: string; reason: string; conflictWith?: string }> = []
        const seen = new Set<string>()

        for (const raw of dto.aliases) {
            const externalName = raw.trim()
            const normalizedName = normalizeAlias(externalName)
            if (!normalizedName) {
                skipped.push({ alias: raw, reason: 'EMPTY' })
                continue
            }
            if (seen.has(normalizedName)) {
                skipped.push({ alias: raw, reason: 'DUPLICATE_IN_REQUEST' })
                continue
            }
            seen.add(normalizedName)

            const existing = await this.prisma.salesEntityAlias.findFirst({
                where: { entityType: dto.entityType, normalizedName, validTo: null },
                include: {
                    party: { select: { name: true } },
                    warehouse: { select: { name: true } },
                    product: { select: { name: true } },
                },
            })
            if (existing) {
                const owner = this.entityIdOf(existing)
                if (owner === dto.entityId) {
                    skipped.push({ alias: raw, reason: 'ALREADY_EXISTS' })
                } else {
                    // Never reassign silently: the business decides who owns the spelling.
                    skipped.push({
                        alias: raw,
                        reason: 'CONFLICT',
                        conflictWith:
                            existing.party?.name ?? existing.warehouse?.name ?? existing.product?.name ?? owner,
                    })
                }
                continue
            }

            await this.prisma.salesEntityAlias.create({
                data: {
                    entityType: dto.entityType,
                    [this.targetField(dto.entityType)]: dto.entityId,
                    externalName,
                    normalizedName,
                    source: dto.source ?? SalesAliasSource.MANUAL,
                    note: dto.note?.trim() || null,
                    createdById: actor.userId,
                },
            })
            added.push(externalName)
        }

        return { entity, added: added.length, addedAliases: added, skipped }
    }

    async update(id: string, dto: UpdateAliasDto, actor: ScopedActor) {
        const alias = await this.prisma.salesEntityAlias.findUnique({ where: { id } })
        if (!alias) throw new NotFoundException('ALIAS_NOT_FOUND')
        const externalName = dto.externalName.trim()
        const normalizedName = normalizeAlias(externalName)
        if (!normalizedName) throw new BadRequestException('ALIAS_EMPTY')

        const clash = await this.prisma.salesEntityAlias.findFirst({
            where: {
                entityType: alias.entityType,
                normalizedName,
                validTo: null,
                id: { not: id },
            },
        })
        if (clash) {
            throw new ConflictException({
                code: 'ALIAS_CONFLICT',
                message: `Cách viết "${externalName}" đã được dùng cho đơn vị khác.`,
            })
        }
        return this.prisma.salesEntityAlias.update({
            where: { id },
            data: { externalName, normalizedName, note: dto.note?.trim() ?? alias.note },
        })
    }

    /** Retire rather than delete, so a spelling that once meant something keeps its history. */
    async retire(id: string) {
        const alias = await this.prisma.salesEntityAlias.findUnique({ where: { id } })
        if (!alias) throw new NotFoundException('ALIAS_NOT_FOUND')
        if (alias.validTo) return alias
        return this.prisma.salesEntityAlias.update({
            where: { id },
            data: { validTo: new Date() },
        })
    }

    /**
     * Imports the spreadsheet as-is: one row per entity, aliases comma-separated, pasted
     * straight from Excel (tab between the two columns) or as CSV.
     */
    async import(dto: ImportAliasDto, actor: ScopedActor) {
        const rows = dto.text
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
        if (!rows.length) throw new BadRequestException('IMPORT_TEXT_EMPTY')

        const entities = await this.entities(dto.entityType)
        // Index by every shape we can derive, so "Kho Hải Linh HP" finds its row.
        const index = new Map<string, EntityRow[]>()
        const push = (key: string, row: EntityRow) => {
            if (!key) return
            const list = index.get(key) ?? []
            list.push(row)
            index.set(key, list)
        }
        for (const row of entities) {
            push(normalizeAlias(row.name), row)
            push(normalizeAlias(row.code ?? ''), row)
        }

        const report = {
            rows: rows.length,
            matchedEntities: 0,
            addedAliases: 0,
            unknownEntities: [] as string[],
            duplicates: [] as string[],
            conflicts: [] as Array<{ alias: string; wanted: string; currentlyPointsTo: string }>,
        }

        for (const line of rows) {
            // Excel paste gives a tab; a CSV export gives a comma before the alias list.
            const separatorIndex = line.includes('\t') ? line.indexOf('\t') : line.indexOf(',')
            if (separatorIndex < 0) {
                report.unknownEntities.push(line)
                continue
            }
            const entityName = line.slice(0, separatorIndex).trim()
            const aliasBlob = line.slice(separatorIndex + 1)

            const matches = index.get(normalizeAlias(entityName)) ?? []
            if (matches.length !== 1) {
                report.unknownEntities.push(entityName)
                continue
            }
            report.matchedEntities += 1

            const aliases = aliasBlob
                .split(',')
                .map((value) => value.trim())
                .filter(Boolean)
            // The entity's own name is worth storing too: it is how many people write it.
            const result = await this.create(
                {
                    entityType: dto.entityType,
                    entityId: matches[0].id,
                    aliases: [entityName, ...aliases],
                    source: SalesAliasSource.IMPORTED,
                },
                actor,
            )
            report.addedAliases += result.added
            for (const skip of result.skipped) {
                if (skip.reason === 'CONFLICT') {
                    report.conflicts.push({
                        alias: skip.alias,
                        wanted: matches[0].name,
                        currentlyPointsTo: skip.conflictWith ?? '',
                    })
                } else if (skip.reason !== 'EMPTY') {
                    report.duplicates.push(skip.alias)
                }
            }
        }
        return report
    }

    /**
     * Records the spelling a sale resolved by hand, so the next paste matches on its own.
     * Only ever called from an explicit confirmation — never from an AI guess — and never
     * over an existing mapping.
     */
    async learn(
        entityType: SalesAliasEntityType,
        entityId: string,
        rawText: string,
        actor: ScopedActor,
    ) {
        const normalizedName = normalizeAlias(rawText)
        if (!normalizedName) return null
        const existing = await this.prisma.salesEntityAlias.findFirst({
            where: { entityType, normalizedName, validTo: null },
        })
        if (existing) return null
        return this.prisma.salesEntityAlias.create({
            data: {
                entityType,
                [this.targetField(entityType)]: entityId,
                externalName: rawText.trim(),
                normalizedName,
                source: SalesAliasSource.LEARNED,
                createdById: actor.userId,
            },
        })
    }

    /**
     * Spellings quick entry could not resolve, most frequent first — the working list for
     * whoever maintains the aliases.
     */
    async unmatched(limit = 50) {
        const logs = await this.prisma.salesQuickEntryLog.findMany({
            where: { unmatched: { not: Prisma.DbNull } },
            select: { unmatched: true, createdAt: true },
            orderBy: { createdAt: 'desc' },
            take: 500,
        })
        const counter = new Map<string, { entityType: string; text: string; count: number; lastSeenAt: Date }>()
        for (const log of logs) {
            const items = (log.unmatched ?? []) as Array<{ entityType: string; text: string }>
            if (!Array.isArray(items)) continue
            for (const item of items) {
                if (!item?.text) continue
                const key = `${item.entityType}:${normalizeAlias(item.text)}`
                const current = counter.get(key)
                if (current) {
                    current.count += 1
                } else {
                    counter.set(key, {
                        entityType: item.entityType,
                        text: item.text,
                        count: 1,
                        lastSeenAt: log.createdAt,
                    })
                }
            }
        }
        return [...counter.values()].sort((a, b) => b.count - a.count).slice(0, limit)
    }
}
