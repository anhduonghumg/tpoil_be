// price-bulletins.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PriceBulletinStatus, BackgroundJobType } from '@prisma/client'

import { CreatePriceBulletinDto } from './dto/create-price-bulletin.dto'
import { UpdatePriceBulletinDto } from './dto/update-price-bulletin.dto'
import { ListPriceItemsDto } from './dto/list-price-bulletins.dto'
import { CommitImportDto } from './dto/import-price-bulletin-pdf.dto'

import { ARTIFACT_PRICE_PDF_INPUT, ARTIFACT_PRICE_PDF_PREVIEW, QB_PRICE_BULLETIN } from './jobs/price-bulletin-queues'

import { JobArtifactsService } from '../job-artifacts/job-artifacts.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'

import { ProductMatcher } from './matching/product-matcher'
import { RegionMatcher } from './matching/region-matcher'
import { PricePdfPreviewLine, PricePdfPreviewResult } from './types/price-pdf-preview'
import { BackgroundJobsService } from '../background-jobs/background-jobs.service'
import { PricePdfStorage } from './price-file.storage'
import * as fs from 'fs/promises'
import pdf = require('pdf-parse')
import { Decimal } from '@prisma/client/runtime/library'
// const pdfParse = require('pdf-parse')
// const pdf = require('pdf-parse')
// import dayjs from 'dayjs'

type RawLine = { productNameRaw: string; priceV1: number; priceV2: number }

// function uniqKey(productId: string, regionId: string) {
//     return `${productId}__${regionId}`
// }

@Injectable()
export class PriceBulletinsService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly artifacts: JobArtifactsService,
        private readonly bg: BackgroundJobsService,
        private readonly storage: PricePdfStorage,
        private readonly productMatcher: ProductMatcher,
        private readonly regionMatcher: RegionMatcher,
    ) {}

    async startImportPreview(file: Express.Multer.File) {
        const { filePath, checksum } = await this.storage.savePdfBuffer({
            buffer: file.buffer,
            originalName: file.originalname,
        })

        const run = await this.bg.createRun({
            type: BackgroundJobType.PRICE_BULLETIN_IMPORT_PDF,
            name: `Bóc tách PDF: ${file.originalname}`,
            payload: { fileName: file.originalname, filePath, checksum },
        })

        await this.artifacts.upsertArtifact({
            runId: run.id,
            kind: ARTIFACT_PRICE_PDF_INPUT,
            fileUrl: filePath,
            checksum,
            content: { fileName: file.originalname },
        })

        await this.bg.enqueueRun({
            type: BackgroundJobType.PRICE_BULLETIN_IMPORT_PDF,
            queueName: QB_PRICE_BULLETIN,
            runId: run.id,
            profile: 'pdf_parse',
        })

        return { runId: run.id, checksum, message: 'Đang xử lý file PDF...' }
    }

    async handleWorkerJob(runId: string) {
        await this.bg.markProcessing(runId)
        try {
            const input = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_INPUT)
            if (!input?.fileUrl) throw new Error('Không tìm thấy tệp tin PDF')

            const buffer = await fs.readFile(input.fileUrl)
            const preview = await this.parseAndMapPdf(buffer)

            await this.artifacts.upsertArtifact({
                runId,
                kind: ARTIFACT_PRICE_PDF_PREVIEW,
                content: preview as any,
                checksum: input.checksum ?? undefined,
            })

            await this.bg.markSuccess(runId, { stats: preview.stats })
            return preview
        } catch (err) {
            await this.bg.markFailed(runId, err)
            throw err
        }
    }

    async list(q: { keyword?: string; status?: PriceBulletinStatus; page?: number; pageSize?: number }) {
        const page = q.page ?? 1
        const pageSize = q.pageSize ?? 50
        const keyword = (q.keyword ?? '').trim()

        const where: Prisma.PriceBulletinWhereInput = {
            ...(q.status ? { status: q.status } : {}),
            ...(keyword
                ? {
                      OR: [
                          { note: { contains: keyword, mode: 'insensitive' } },
                          { source: { contains: keyword, mode: 'insensitive' } },
                          { fileChecksum: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }

        const [total, items] = await Promise.all([
            this.prisma.priceBulletin.count({ where }),
            this.prisma.priceBulletin.findMany({
                where,
                orderBy: [{ effectiveFrom: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    items: {
                        include: {
                            product: { select: { id: true, code: true, name: true } },
                            region: { select: { id: true, code: true, name: true } },
                        },
                        orderBy: [{ productId: 'asc' }, { regionId: 'asc' }],
                    },
                },
            }),
        ])

        return { items, total, page, pageSize }
    }

    async listPriceItems(dto: ListPriceItemsDto) {
        const page = Math.max(1, Number(dto.page ?? 1))
        const pageSize = Math.min(200, Math.max(1, Number(dto.pageSize ?? 50)))
        const keyword = (dto.keyword ?? '').trim()
        const onDate = (dto.onDate ?? '').trim()

        const and: Prisma.PriceBulletinItemWhereInput[] = []

        if (dto.productId) and.push({ productId: dto.productId })
        if (dto.regionId) and.push({ regionId: dto.regionId })

        const bulletinWhere: Prisma.PriceBulletinWhereInput = {
            ...(dto.status ? { status: dto.status } : {}),
            ...(onDate
                ? {
                      effectiveFrom: { lte: new Date(`${onDate}T23:59:59.999Z`) },
                      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(`${onDate}T00:00:00.000Z`) } }],
                  }
                : {}),
        }

        if (Object.keys(bulletinWhere).length) {
            and.push({ bulletin: { is: bulletinWhere } })
        }

        if (keyword) {
            and.push({
                OR: [
                    { product: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
                    { product: { is: { code: { contains: keyword, mode: 'insensitive' } } } },
                    { region: { is: { name: { contains: keyword, mode: 'insensitive' } } } },
                    { region: { is: { code: { contains: keyword, mode: 'insensitive' } } } },
                ],
            })
        }

        const where: Prisma.PriceBulletinItemWhereInput = and.length ? { AND: and } : {}

        const [total, items] = await Promise.all([
            this.prisma.priceBulletinItem.count({ where }),
            this.prisma.priceBulletinItem.findMany({
                where,
                skip: (page - 1) * pageSize,
                take: pageSize,
                orderBy: [{ bulletin: { effectiveFrom: 'desc' } }, { product: { name: 'asc' } }, { region: { name: 'asc' } }],
                select: {
                    id: true,
                    price: true,
                    productId: true,
                    regionId: true,
                    bulletinId: true,
                    product: { select: { id: true, code: true, name: true } },
                    region: { select: { id: true, code: true, name: true } },
                    bulletin: {
                        select: {
                            id: true,
                            status: true,
                            effectiveFrom: true,
                            effectiveTo: true,
                        },
                    },
                },
            }),
        ])

        return {
            items: items.map((x) => ({
                id: x.id,
                price: x.price,
                productId: x.productId,
                productCode: x.product?.code ?? '',
                productName: x.product?.name ?? '',
                regionId: x.regionId,
                regionCode: x.region?.code ?? '',
                regionName: x.region?.name ?? '',
                bulletinId: x.bulletinId,
                status: x.bulletin.status,
                effectiveFrom: x.bulletin.effectiveFrom,
                effectiveTo: x.bulletin.effectiveTo,
            })),
            total,
            page,
            pageSize,
        }
    }

    async detail(id: string) {
        const row = await this.prisma.priceBulletin.findUnique({
            where: { id },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        region: { select: { id: true, code: true, name: true } },
                    },
                    orderBy: [{ regionId: 'asc' }],
                },
            },
        })
        if (!row) throw new NotFoundException('PriceBulletin not found')
        return row
    }

    private parseVnNumber(s: string) {
        const cleaned = String(s ?? '')
            .replace(/[^\d.,]/g, '')
            .replace(/,/g, '.')
        return Number(cleaned.replace(/\./g, ''))
    }

    private extractTpoilData(text: string): { effectiveFrom: Date; lines: RawLine[] } {
        const t = text
            .replace(/\u00A0/g, ' ')
            .replace(/\r/g, ' ')
            .replace(/\n/g, ' ')
            .replace(/\s+/g, ' ')

        const effMatch = t.match(/hiệu lực từ\s*(\d{1,2})\s*giờ\s*(\d{1,2})\s*phút,?\s*ngày\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i)
        if (!effMatch) throw new Error('Không tìm thấy mốc thời gian hiệu lực')
        const [_, hh, mm, dd, MM, yyyy] = effMatch
        const effectiveFrom = new Date(Date.UTC(Number(yyyy), Number(MM) - 1, Number(dd), Number(hh) - 7, Number(mm)))

        const lineRegex = /(Xăng|Dầu|Điêzen|Mazut)\s+([^Đ]+?)\s+Đồng\/lít\s+([\d.,]+)\s+([\d.,]+)/gi

        const lines: RawLine[] = []
        let match

        while ((match = lineRegex.exec(t)) !== null) {
            const productNameRaw = `${match[1]} ${match[2]}`.trim()

            const priceV1 = this.parseVnNumber(match[3])
            const priceV2 = this.parseVnNumber(match[4])

            if (priceV1 > 0 && priceV2 > 0) {
                lines.push({ productNameRaw, priceV1, priceV2 })
            }
        }

        return { effectiveFrom, lines }
    }

    private async assertProducts(productIds: string[]) {
        const products = await this.prisma.product.findMany({
            where: { id: { in: productIds } },
            select: { id: true },
        })
        const ok = new Set(products.map((x) => x.id))
        const invalid = productIds.filter((id) => !ok.has(id))
        if (invalid.length) {
            throw new BadRequestException({ code: 'INVALID_PRODUCTS', message: 'Có sản phẩm không hợp lệ', invalidProductIds: invalid })
        }
    }

    private async assertRegions(regionIds: string[]) {
        const regions = await this.prisma.priceRegion.findMany({
            where: { id: { in: regionIds }, isActive: true },
            select: { id: true },
        })
        const ok = new Set(regions.map((x) => x.id))
        const invalid = regionIds.filter((id) => !ok.has(id))
        if (invalid.length) {
            throw new BadRequestException({ code: 'INVALID_REGIONS', message: 'Có vùng giá không hợp lệ', invalidRegionIds: invalid })
        }
    }

    private normalizeDateOnly(s: string) {
        return new Date(`${s}T00:00:00.000+07:00`)
    }

    async create(dto: CreatePriceBulletinDto) {
        if (!dto.items?.length) throw new BadRequestException({ code: 'REQUIRED_ITEMS', message: 'Cần ít nhất 1 dòng giá' })

        const productIds = Array.from(new Set(dto.items.map((x) => x.productId)))
        const regionIds = Array.from(new Set(dto.items.map((x) => x.regionId)))
        await this.assertProducts(productIds)
        await this.assertRegions(regionIds)

        const effectiveFrom = this.normalizeDateOnly(dto.effectiveFrom)
        const effectiveTo = dto.effectiveTo ? this.normalizeDateOnly(dto.effectiveTo) : null
        if (effectiveTo && effectiveTo < effectiveFrom) {
            throw new BadRequestException({ code: 'INVALID_DATE_RANGE', message: 'effectiveTo phải >= effectiveFrom' })
        }

        return this.prisma.$transaction(async (tx) => {
            const bulletin = await tx.priceBulletin.create({
                data: {
                    status: dto.status ?? PriceBulletinStatus.DRAFT,
                    effectiveFrom,
                    effectiveTo,
                    note: dto.note?.trim() || null,
                    fileUrl: dto.fileUrl?.trim() || null,
                    fileChecksum: dto.fileChecksum?.trim() || null,
                    publishedAt: effectiveFrom,
                },
            })

            await tx.priceBulletinItem.createMany({
                data: dto.items.map((x) => ({
                    bulletinId: bulletin.id,
                    productId: x.productId,
                    regionId: x.regionId,
                    price: x.price,
                    note: x.note?.trim() || null,
                })),
            })

            return bulletin
        })
    }

    async update(id: string, dto: UpdatePriceBulletinDto) {
        const current = await this.prisma.priceBulletin.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('PriceBulletin not found')
        if (current.status !== PriceBulletinStatus.DRAFT) {
            throw new BadRequestException({ code: 'LOCKED', message: 'Chỉ được sửa khi trạng thái DRAFT' })
        }

        const patch: Prisma.PriceBulletinUpdateInput = {
            ...(dto.effectiveFrom !== undefined ? { effectiveFrom: this.normalizeDateOnly(dto.effectiveFrom) } : {}),
            ...(dto.effectiveTo !== undefined ? { effectiveTo: dto.effectiveTo ? this.normalizeDateOnly(dto.effectiveTo) : null } : {}),
            ...(dto.note !== undefined ? { note: dto.note?.trim() || null } : {}),
            ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl?.trim() || null } : {}),
            ...(dto.fileChecksum !== undefined ? { fileChecksum: dto.fileChecksum?.trim() || null } : {}),
        }

        const shouldReplaceItems = dto.items !== undefined

        if (shouldReplaceItems) {
            if (!dto?.items?.length) {
                throw new BadRequestException({ code: 'REQUIRED_ITEMS', message: 'Cần ít nhất 1 dòng giá' })
            }
            const productIds = Array.from(new Set(dto.items.map((x) => x.productId)))
            const regionIds = Array.from(new Set(dto.items.map((x) => x.regionId)))
            await this.assertProducts(productIds)
            await this.assertRegions(regionIds)
        }

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.priceBulletin.update({ where: { id }, data: patch })

            if (shouldReplaceItems) {
                await tx.priceBulletinItem.deleteMany({ where: { bulletinId: id } })
                await tx.priceBulletinItem.createMany({
                    data: dto.items!.map((x) => ({
                        bulletinId: id,
                        productId: x.productId,
                        regionId: x.regionId,
                        price: x.price,
                        note: x.note?.trim() || null,
                    })),
                })
            }

            return updated
        })
    }

    async publish(id: string) {
        const current = await this.prisma.priceBulletin.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('PriceBulletin not found')
        if (current.status === PriceBulletinStatus.VOID) {
            throw new BadRequestException({ code: 'VOIDED', message: 'Bản ghi đã VOID' })
        }

        const now = new Date()
        return this.prisma.priceBulletin.update({
            where: { id },
            data: {
                status: PriceBulletinStatus.PUBLISHED,
                publishedAt: current.publishedAt ?? now,
            },
        })
    }

    async void(id: string) {
        const current = await this.prisma.priceBulletin.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('PriceBulletin not found')
        return this.prisma.priceBulletin.update({ where: { id }, data: { status: PriceBulletinStatus.VOID } })
    }

    async regionsSelect(keyword?: string) {
        const k = (keyword ?? '').trim()

        const items = await this.prisma.priceRegion.findMany({
            where: {
                isActive: true,
                ...(k
                    ? {
                          OR: [{ code: { contains: k, mode: 'insensitive' } }, { name: { contains: k, mode: 'insensitive' } }],
                      }
                    : {}),
            },
            orderBy: [{ code: 'asc' }],
            take: 50,
            select: { id: true, code: true, name: true },
        })

        return items
    }

    /*
    async quotePrice(args: { productId: string; regionCode: string; onDate?: string }) {
        const region = await this.prisma.priceRegion.findUnique({
            where: { code: args.regionCode },
            select: { id: true, code: true, name: true },
        })
        if (!region) throw new NotFoundException('PRICE_REGION_NOT_FOUND')

        const on = args.onDate ? new Date(args.onDate) : new Date()
        if (Number.isNaN(on.getTime())) throw new BadRequestException('INVALID_ON_DATE')

        const bulletin = await this.prisma.priceBulletin.findFirst({
            where: {
                status: PriceBulletinStatus.PUBLISHED,
                effectiveFrom: { lte: on },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }],
            },
            orderBy: [{ effectiveFrom: 'desc' }],
            select: {
                id: true,
                publishedAt: true,
                effectiveFrom: true,
                effectiveTo: true,
            },
        })

        if (!bulletin) {
            return {
                ok: false,
                reason: 'NO_PUBLISHED_BULLETIN',
                productId: args.productId,
                region: { code: region.code, name: region.name },
                onDate: on.toISOString(),
            }
        }

        const item = await this.prisma.priceBulletinItem.findFirst({
            where: {
                bulletinId: bulletin.id,
                productId: args.productId,
                regionId: region.id,
            },
            select: { price: true },
        })

        if (!item) {
            return {
                ok: false,
                reason: 'NO_PRICE_FOR_PRODUCT_REGION',
                productId: args.productId,
                region: { code: region.code, name: region.name },
                bulletin,
            }
        }

        return {
            ok: true,
            productId: args.productId,
            region: { code: region.code, name: region.name },
            bulletin,
            price: item.price,
        }
    }
        */

    async quotePrice(args: { productId: string; regionCode: string; onDate?: string }) {
        const region = await this.prisma.priceRegion.findUnique({
            where: { code: args.regionCode },
            select: { id: true, code: true, name: true },
        })
        if (!region) throw new NotFoundException('PRICE_REGION_NOT_FOUND')

        const on = args.onDate ? new Date(args.onDate) : new Date()
        if (Number.isNaN(on.getTime())) throw new BadRequestException('INVALID_ON_DATE')

        const row = await this.prisma.priceBulletinItem.findFirst({
            where: {
                productId: args.productId,
                regionId: region.id,
                bulletin: {
                    is: {
                        status: PriceBulletinStatus.PUBLISHED,
                        effectiveFrom: { lte: on },
                        OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }], // end exclusive
                    },
                },
            },
            orderBy: [{ bulletin: { effectiveFrom: 'desc' } }],
            select: {
                price: true,
                bulletin: { select: { id: true, publishedAt: true, effectiveFrom: true, effectiveTo: true } },
            },
        })

        if (!row) {
            return {
                ok: false,
                reason: 'NO_PRICE',
                productId: args.productId,
                region: { code: region.code, name: region.name },
                onDate: on.toISOString(),
            }
        }

        return {
            ok: true,
            productId: args.productId,
            region: { code: region.code, name: region.name },
            bulletin: row.bulletin,
            price: row.price,
        }
    }

    async quoteBatch(args: { productIds: string[]; regionCode: string; onDate?: string }) {
        const regionCode = (args.regionCode ?? '').trim()
        if (!regionCode) {
            throw new BadRequestException({ code: 'REGION_CODE_REQUIRED', message: 'regionCode is required' })
        }

        const region = await this.prisma.priceRegion.findUnique({
            where: { code: regionCode },
            select: { id: true, code: true, name: true },
        })
        if (!region) throw new NotFoundException('PRICE_REGION_NOT_FOUND')

        const on = args.onDate ? new Date(args.onDate) : new Date()
        if (Number.isNaN(on.getTime())) throw new BadRequestException('INVALID_ON_DATE')

        const rows = await this.prisma.priceBulletinItem.findMany({
            where: {
                productId: { in: args.productIds },
                regionId: region.id,
                bulletin: {
                    is: {
                        status: PriceBulletinStatus.PUBLISHED,
                        effectiveFrom: { lte: on },
                        OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }],
                    },
                },
            },
            orderBy: [{ bulletin: { effectiveFrom: 'desc' } }],
            select: {
                productId: true,
                price: true,
                bulletin: {
                    select: {
                        id: true,
                        publishedAt: true,
                        effectiveFrom: true,
                        effectiveTo: true,
                    },
                },
            },
        })

        const priceMap = new Map<string, { price: Decimal; bulletin: any }>()
        for (const r of rows) {
            if (!priceMap.has(r.productId)) {
                priceMap.set(r.productId, {
                    price: r.price,
                    bulletin: r.bulletin,
                })
            }
        }

        const firstBulletin = rows[0]?.bulletin

        return {
            ok: true,
            region: { code: region.code, name: region.name },
            bulletin: firstBulletin ?? null,
            items: args.productIds.map((pid) => ({
                productId: pid,
                price: priceMap.get(pid)?.price ?? null,
            })),
        }
    }

    async importPdfCommit(dto: CommitImportDto) {
        const newFrom = new Date(dto.effectiveFrom)
        if (Number.isNaN(newFrom.getTime())) {
            throw new BadRequestException({ code: 'INVALID_EFFECTIVE_FROM', message: 'effectiveFrom không hợp lệ' })
        }

        if (!dto.lines?.length) {
            throw new BadRequestException({ code: 'REQUIRED_LINES', message: 'Cần ít nhất 1 dòng giá' })
        }

        const invalid = dto.lines.filter((l) => !l.productId || !l.regionId || !Number.isFinite(l.price) || l.price <= 0)
        if (invalid.length) {
            throw new BadRequestException({ code: 'INVALID_LINES', message: 'Có dòng giá không hợp lệ', count: invalid.length })
        }

        const seen = new Set<string>()
        const dup: Array<{ productId: string; regionId: string }> = []
        for (const l of dto.lines) {
            const k = `${l.productId}::${l.regionId}`
            if (seen.has(k)) dup.push({ productId: l.productId, regionId: l.regionId })
            seen.add(k)
        }
        if (dup.length) {
            throw new BadRequestException({ code: 'DUPLICATE_LINES', message: 'Trùng dòng (product, region)', duplicates: dup })
        }

        await this.assertProducts(Array.from(new Set(dto.lines.map((x) => x.productId))))
        await this.assertRegions(Array.from(new Set(dto.lines.map((x) => x.regionId))))

        return this.prisma.$transaction(async (tx) => {
            const sameTime = await tx.priceBulletin.findFirst({
                where: { effectiveFrom: newFrom, status: PriceBulletinStatus.PUBLISHED },
                select: { id: true },
            })

            if (sameTime) {
                if (!dto.isOverride) {
                    throw new BadRequestException({ code: 'SAME_TIME_EXISTS', message: 'Đã có bảng giá PUBLISHED tại effectiveFrom này' })
                }
                await tx.priceBulletin.updateMany({
                    where: { effectiveFrom: newFrom, status: PriceBulletinStatus.PUBLISHED },
                    data: { status: PriceBulletinStatus.VOID },
                })
            }

            const nextB = await tx.priceBulletin.findFirst({
                where: { effectiveFrom: { gt: newFrom }, status: PriceBulletinStatus.PUBLISHED },
                orderBy: { effectiveFrom: 'asc' },
                select: { id: true, effectiveFrom: true },
            })

            const prevB = await tx.priceBulletin.findFirst({
                where: { effectiveFrom: { lt: newFrom }, status: PriceBulletinStatus.PUBLISHED },
                orderBy: { effectiveFrom: 'desc' },
                select: { id: true, effectiveFrom: true, effectiveTo: true },
            })

            if (nextB && !(newFrom < nextB.effectiveFrom)) {
                throw new BadRequestException({ code: 'INVALID_TIMELINE', message: 'effectiveFrom không hợp lệ so với bảng giá kế tiếp' })
            }
            if (prevB && !(prevB.effectiveFrom < newFrom)) {
                throw new BadRequestException({ code: 'INVALID_TIMELINE', message: 'effectiveFrom không hợp lệ so với bảng giá trước đó' })
            }

            if (prevB) {
                await tx.priceBulletin.update({
                    where: { id: prevB.id },
                    data: { effectiveTo: newFrom },
                })
            }

            const bulletin = await tx.priceBulletin.create({
                data: {
                    status: PriceBulletinStatus.PUBLISHED,
                    effectiveFrom: newFrom,
                    effectiveTo: nextB ? nextB.effectiveFrom : null,
                    publishedAt: new Date(),
                    source: 'PDF_IMPORT_PREVIEW_COMMIT',
                },
                select: { id: true, effectiveFrom: true, effectiveTo: true, status: true },
            })

            await tx.priceBulletinItem.createMany({
                data: dto.lines.map((l) => ({
                    bulletinId: bulletin.id,
                    productId: l.productId,
                    regionId: l.regionId,
                    price: l.price,
                })),
            })

            return bulletin
        })
    }

    async parseAndMapPdf(buffer: Buffer): Promise<PricePdfPreviewResult> {
        const parsed = await pdf(buffer)
        const rawText = parsed.text
        const { effectiveFrom, lines: rawLines } = this.extractTpoilData(rawText)
        const r1 = await this.regionMatcher.findByCodeOrName('VÙNG I')
        const r2 = await this.regionMatcher.findByCodeOrName('VÙNG II')
        const previewLines: PricePdfPreviewLine[] = []
        const warnings: string[] = []

        let rowNo = 0

        for (const raw of rawLines) {
            rowNo++

            const match = await this.productMatcher.match(raw.productNameRaw, { source: 'TPOIL' })

            const pairs: Array<{ region: typeof r1; price: number; label: string }> = [
                { region: r1, price: raw.priceV1, label: 'VÙNG I' },

                { region: r2, price: raw.priceV2, label: 'VÙNG II' },
            ]

            for (const p of pairs) {
                const issues: any[] = []

                const price = p.price

                if (!Number.isFinite(price) || price <= 0) {
                    issues.push({ code: 'INVALID_PRICE', message: `Giá không hợp lệ (${p.label})` })
                }

                if (!p.region) {
                    issues.push({ code: 'REGION_NOT_FOUND', message: `Không tìm thấy vùng giá: ${p.label}` })
                }

                if (match.ok) {
                    previewLines.push({
                        rowNo,
                        productRaw: raw.productNameRaw,
                        canonicalKey: match.canonicalKey,
                        productId: match.productId,
                        matchedBy: match.matchedBy,
                        confidence: match.confidence,
                        regionId: p.region?.id,
                        regionCode: p.region?.code,
                        regionName: p.region?.name,
                        price,
                        issues,
                    })
                } else {
                    const code = match.reason === 'AMBIGUOUS' ? 'PRODUCT_AMBIGUOUS' : 'PRODUCT_NOT_FOUND'

                    issues.push({
                        code,
                        message: match.reason === 'AMBIGUOUS' ? 'Tên sản phẩm mơ hồ, cần chọn thủ công' : 'Không tìm thấy sản phẩm trong danh mục',
                        suggestions: match.suggestions,
                    })

                    previewLines.push({
                        rowNo,
                        productRaw: raw.productNameRaw,
                        canonicalKey: match.canonicalKey,
                        regionId: p.region?.id,
                        regionCode: p.region?.code,
                        regionName: p.region?.name,
                        price,
                        issues,
                    })
                }
            }
        }

        const conflict = await this.checkTimeConflict(effectiveFrom)
        const total = previewLines.length
        const withIssues = previewLines.filter((x) => x.issues?.length).length
        const notFound = previewLines.filter((x) => x.issues?.some((i: any) => i.code === 'PRODUCT_NOT_FOUND')).length
        const ambiguous = previewLines.filter((x) => x.issues?.some((i: any) => i.code === 'PRODUCT_AMBIGUOUS')).length
        const ok = total - withIssues

        if (notFound) warnings.push(`Có ${notFound} dòng không map được sản phẩm.`)

        if (ambiguous) warnings.push(`Có ${ambiguous} dòng sản phẩm mơ hồ cần chọn thủ công.`)

        return {
            source: 'TPOIL',
            effectiveFrom: effectiveFrom.toISOString(),
            lines: previewLines,
            warnings,
            conflict,
            stats: { total, ok, withIssues, notFound, ambiguous },
        }
    }
    async updatePreviewLine(runId: string, rowNo: number, updateDto: any) {
        const artifact = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_PREVIEW)
        const preview = artifact?.content as any

        preview.lines.forEach((line: any) => {
            if (line.rowNo === rowNo) {
                line.productId = updateDto.productId
                line.issues = (line.issues || []).filter((i: any) => !i.code.startsWith('PRODUCT_'))
            }
        })

        const total = preview.lines.length
        const withIssues = preview.lines.filter((l: any) => l.issues.length > 0).length
        const ok = total - withIssues

        preview.stats = {
            ...preview.stats,
            total,
            withIssues,
            ok,
            notFound: preview.lines.filter((l: any) => l.issues.some((i: any) => i.code === 'PRODUCT_NOT_FOUND')).length,
            ambiguous: preview.lines.filter((l: any) => l.issues.some((i: any) => i.code === 'PRODUCT_AMBIGUOUS')).length,
        }
        await this.artifacts.upsertArtifact({
            runId,
            kind: ARTIFACT_PRICE_PDF_PREVIEW,
            content: preview,
        })

        return preview
    }

    private async getRegionMap() {
        const regions = await this.prisma.priceRegion.findMany({ select: { id: true, name: true } })
        return new Map(regions.map((r) => [r.name.toUpperCase(), r.id]))
    }

    private async getProductMap() {
        const products = await this.prisma.product.findMany({ select: { id: true, name: true } })
        return new Map(products.map((p) => [p.name.toUpperCase(), p.id]))
    }

    private async checkTimeConflict(effectiveFrom: Date) {
        const same = await this.prisma.priceBulletin.findFirst({
            where: { effectiveFrom, status: 'PUBLISHED' },
        })
        if (same) return { type: 'SAME_TIME', message: 'Đã có bảng giá đúng vào giờ này.' }

        const newer = await this.prisma.priceBulletin.findFirst({
            where: { effectiveFrom: { gt: effectiveFrom }, status: 'PUBLISHED' },
        })
        if (newer) return { type: 'BACKDATED', message: 'Bạn đang thêm giá cho một thời điểm trong quá khứ.' }

        return null
    }

    async getImportStatus(runId: string) {
        const run = await this.prisma.backgroundJobRun.findUnique({
            where: { id: runId },
            select: { id: true, status: true, metrics: true, error: true, startedAt: true, finishedAt: true },
        })
        if (!run) throw new BadRequestException('Không tìm thấy phiên làm việc')

        const artifact = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_PREVIEW)

        return {
            id: run.id,
            status: run.status,
            metrics: run.metrics,
            previewAvailable: !!artifact,
            error: run.error,
            startedAt: run.startedAt,
            finishedAt: run.finishedAt,
            isDone: run.status === 'SUCCESS',
            isFailed: run.status === 'FAILED',
        }
    }

    async getPreviewData(runId: string) {
        const a = await this.artifacts.getArtifact(runId, ARTIFACT_PRICE_PDF_PREVIEW)
        if (!a) throw new NotFoundException('Chưa có dữ liệu preview')
        console.log(a.content)
        return a.content
    }
}
