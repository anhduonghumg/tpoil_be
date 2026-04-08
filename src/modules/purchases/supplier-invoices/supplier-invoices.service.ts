import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryService } from '../../inventory/inventory.service'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'
import { GoogleDriveService } from 'src/infra/google-drive/google-drive.service'
import { BackgroundJobType, SupplierInvoiceStatus, SettlementType, SettlementStatus, InventoryLedgerSourceType, Prisma } from '@prisma/client'
import * as crypto from 'node:crypto'
import { ARTIFACT_PDF_INPUT, ARTIFACT_PDF_PREVIEW, QB_SUPPLIER_INVOICE } from './jobs/supplier-invoice-queues'
import { CreateSupplierInvoiceDto } from './dto/supplier-invoice.dto'
import PdfParse from 'pdf-parse'

@Injectable()
export class SupplierInvoicesService {
    private readonly FAST_PATH_MAX_SIZE = 2 * 1024 * 1024 // 2MB

    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryService,
        private readonly bgJobs: BackgroundJobsService,
        private readonly artifacts: JobArtifactsService,
        private readonly drive: GoogleDriveService,
    ) {}

    private async findExistingFileByChecksum(checksum: string) {
        return this.prisma.jobArtifact.findFirst({
            where: {
                kind: ARTIFACT_PDF_INPUT,
                checksum,
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                fileUrl: true,
                checksum: true,
                content: true,
            },
        })
    }

    private async parsePdfBuffer(buffer: Buffer) {
        const pdf = await PdfParse(buffer)
        const text = pdf.text || ''
        return this.parsePVOIL(text)
    }

    private parsePVOIL(text: string) {
        const normalizeMoney = (raw?: string | null): number | null => {
            if (!raw) return null
            const cleaned = raw.replace(/\./g, '').replace(',', '.').trim()
            const n = Number(cleaned)
            return Number.isFinite(n) ? n : null
        }

        const invoiceNo = text.match(/Số\s*\(No\.\)\s*:\s*([0-9]+)/i)?.[1]?.trim() ?? text.match(/Số\s*\(No\.\)\.?\s*:\s*([0-9]+)/i)?.[1]?.trim() ?? null

        const invoiceSymbol = text.match(/Ký hiệu\s*:\s*([A-Z0-9]+)/i)?.[1]?.trim() ?? null

        const dateMatch = text.match(/Ngày.*?(\d{1,2})\s+tháng.*?(\d{1,2})\s+năm.*?(\d{4})/is) ?? text.match(/Ngày.*?(\d{2}).*?(\d{2}).*?(\d{4})/is)

        const invoiceDate = dateMatch ? `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')}` : null

        const subTotal = normalizeMoney(text.match(/Cộng tiền hàng.*?:\s*([\d\.,]+)/i)?.[1] ?? null)

        const vatAmount = normalizeMoney(text.match(/Tiền thuế GTGT.*?:\s*([\d\.,]+)/i)?.[1] ?? null)

        const totalAmount = normalizeMoney(text.match(/Tổng cộng tiền thanh toán.*?:\s*([\d\.,]+)/i)?.[1] ?? null)

        return {
            invoiceNo,
            invoiceSymbol,
            invoiceDate,
            subTotal,
            vatAmount,
            totalAmount,
        }
    }

    async importPdf(args: { supplierCustomerId: string; purchaseOrderId?: string; file: Express.Multer.File }) {
        if (!args.file?.buffer?.length) {
            throw new BadRequestException('File is required')
        }

        const supplier = await this.prisma.customer.findUnique({
            where: { id: args.supplierCustomerId },
            select: { id: true, isSupplier: true, name: true },
        })
        if (!supplier) throw new BadRequestException('SUPPLIER_NOT_FOUND')
        if (!supplier.isSupplier) throw new BadRequestException('NOT_SUPPLIER')

        const checksum = crypto.createHash('sha256').update(args.file.buffer).digest('hex')
        const existing = await this.findExistingFileByChecksum(checksum)

        const canFastPath = args.file.size <= this.FAST_PATH_MAX_SIZE

        if (canFastPath) {
            try {
                let sourceFileId: string | null = null
                let sourceFileUrl: string | null = null
                let sourceFileName: string | null = null

                if (existing?.content && typeof existing.content === 'object') {
                    const c = existing.content as any
                    sourceFileId = c.fileId ?? null
                    sourceFileUrl = existing.fileUrl ?? c.fileUrl ?? null
                    sourceFileName = c.fileName ?? null
                } else {
                    const uploaded = await this.drive.uploadPdf({
                        buffer: args.file.buffer,
                        fileName: args.file.originalname,
                    })
                    sourceFileId = uploaded.fileId
                    sourceFileUrl = uploaded.webViewLink ?? null
                    sourceFileName = uploaded.fileName
                }

                const extracted = await this.parsePdfBuffer(args.file.buffer)

                if (!existing) {
                    const run = await this.bgJobs.createRun({
                        type: BackgroundJobType.SUPPLIER_INVOICE_IMPORT_PDF,
                        name: 'Import Supplier Invoice PDF (sync)',
                        payload: {
                            supplierCustomerId: args.supplierCustomerId,
                            purchaseOrderId: args.purchaseOrderId ?? null,
                            checksum,
                            mode: 'sync',
                        },
                    })

                    await this.artifacts.upsertArtifact({
                        runId: run.id,
                        kind: ARTIFACT_PDF_INPUT,
                        checksum,
                        fileUrl: sourceFileUrl ?? '',
                        content: {
                            supplierCustomerId: args.supplierCustomerId,
                            purchaseOrderId: args.purchaseOrderId ?? null,
                            supplierName: supplier.name,
                            fileId: sourceFileId,
                            fileName: sourceFileName,
                            fileUrl: sourceFileUrl,
                        },
                    })
                }

                return {
                    mode: 'sync',
                    status: 'SUCCESS',
                    sourceFileId,
                    sourceFileUrl,
                    sourceFileName,
                    sourceFileChecksum: checksum,
                    extracted,
                    warnings: existing ? ['File đã tồn tại, dùng lại file cũ'] : [],
                }
            } catch {
                // fallback async
            }
        }

        const run = await this.bgJobs.createRun({
            type: BackgroundJobType.SUPPLIER_INVOICE_IMPORT_PDF,
            name: 'Import Supplier Invoice PDF',
            payload: {
                supplierCustomerId: args.supplierCustomerId,
                purchaseOrderId: args.purchaseOrderId ?? null,
                checksum,
                mode: 'async',
            },
        })

        await this.artifacts.upsertArtifact({
            runId: run.id,
            kind: ARTIFACT_PDF_INPUT,
            checksum,
            content: {
                supplierCustomerId: args.supplierCustomerId,
                purchaseOrderId: args.purchaseOrderId ?? null,
                supplierName: supplier.name,
                fileName: args.file.originalname,
                bufferBase64: args.file.buffer.toString('base64'),
            },
        })

        await this.bgJobs.enqueueRun({
            type: BackgroundJobType.SUPPLIER_INVOICE_IMPORT_PDF,
            queueName: QB_SUPPLIER_INVOICE,
            runId: run.id,
            profile: 'pdf_parse',
        })

        return {
            mode: 'async',
            status: 'QUEUED',
            runId: run.id,
            warnings: ['File đang được xử lý nền'],
        }
    }

    async getImportPdfResult(runId: string) {
        const run = await this.prisma.backgroundJobRun.findUnique({
            where: { id: runId },
            select: { id: true, status: true, error: true, metrics: true },
        })
        if (!run) throw new BadRequestException('RUN_NOT_FOUND')

        const preview = await this.artifacts.getArtifact(runId, ARTIFACT_PDF_PREVIEW)

        const content = (preview?.content ?? {}) as any

        return {
            mode: 'async',
            status: run.status,
            runId,
            sourceFileId: content.sourceFileId ?? null,
            sourceFileUrl: content.sourceFileUrl ?? null,
            sourceFileName: content.sourceFileName ?? null,
            sourceFileChecksum: content.sourceFileChecksum ?? null,
            extracted: content.extracted ?? null,
            warnings: content.warnings ?? [],
            error: run.error ?? null,
            metrics: run.metrics ?? null,
        }
    }

    async handleWorkerJob(runId: string) {
        await this.bgJobs.markProcessing(runId)

        try {
            const input = await this.artifacts.getArtifact(runId, ARTIFACT_PDF_INPUT)
            if (!input?.content) throw new Error('Missing PDF input artifact')

            const c = input.content as any
            const checksum = input.checksum ?? undefined
            const bufferBase64 = c.bufferBase64 as string | undefined
            const fileName = c.fileName as string | undefined

            if (!bufferBase64) throw new Error('Missing file buffer')

            const buffer = Buffer.from(bufferBase64, 'base64')
            const existing = checksum ? await this.findExistingFileByChecksum(checksum) : null

            let sourceFileId: string | null = null
            let sourceFileUrl: string | null = null
            let sourceFileName: string | null = null

            if (existing?.content && typeof existing.content === 'object') {
                const ec = existing.content as any
                sourceFileId = ec.fileId ?? null
                sourceFileUrl = existing.fileUrl ?? ec.fileUrl ?? null
                sourceFileName = ec.fileName ?? null
            } else {
                const uploaded = await this.drive.uploadPdf({
                    buffer,
                    fileName: fileName ?? 'supplier-invoice.pdf',
                })
                sourceFileId = uploaded.fileId
                sourceFileUrl = uploaded.webViewLink ?? null
                sourceFileName = uploaded.fileName

                await this.artifacts.upsertArtifact({
                    runId,
                    kind: ARTIFACT_PDF_INPUT,
                    checksum,
                    fileUrl: sourceFileUrl ?? '',
                    content: {
                        supplierCustomerId: c.supplierCustomerId ?? null,
                        purchaseOrderId: c.purchaseOrderId ?? null,
                        supplierName: c.supplierName ?? null,
                        fileId: sourceFileId,
                        fileName: sourceFileName,
                        fileUrl: sourceFileUrl,
                    },
                })
            }

            const extracted = await this.parsePdfBuffer(buffer)

            await this.artifacts.upsertArtifact({
                runId,
                kind: ARTIFACT_PDF_PREVIEW,
                checksum,
                fileUrl: sourceFileUrl ?? '',
                content: {
                    sourceFileId,
                    sourceFileUrl,
                    sourceFileName,
                    sourceFileChecksum: checksum ?? null,
                    extracted,
                    warnings: existing ? ['File đã tồn tại, dùng lại file cũ'] : [],
                },
            })

            await this.bgJobs.markSuccess(runId, { imported: true })
            return { ok: true }
        } catch (err) {
            await this.bgJobs.markFailed(runId, err)
            return { ok: false }
        }
    }

    async create(dto: CreateSupplierInvoiceDto) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const supplier = await tx.customer.findUnique({
                    where: { id: dto.supplierCustomerId },
                    select: { id: true, isSupplier: true },
                })
                if (!supplier) throw new BadRequestException('SUPPLIER_NOT_FOUND')
                if (!supplier.isSupplier) throw new BadRequestException('NOT_SUPPLIER')

                if (dto.purchaseOrderId) {
                    const po = await tx.purchaseOrder.findUnique({
                        where: { id: dto.purchaseOrderId },
                        select: { id: true, supplierCustomerId: true },
                    })
                    if (!po) throw new BadRequestException('PURCHASE_ORDER_NOT_FOUND')
                    if (po.supplierCustomerId !== dto.supplierCustomerId) {
                        throw new BadRequestException('PO_SUPPLIER_MISMATCH')
                    }

                    const existedForPo = await tx.supplierInvoice.findFirst({
                        where: {
                            purchaseOrderId: dto.purchaseOrderId,
                            status: { not: SupplierInvoiceStatus.VOID },
                        },
                        select: { id: true },
                    })
                    if (existedForPo) {
                        throw new BadRequestException('PURCHASE_ORDER_ALREADY_HAS_INVOICE')
                    }
                }

                const existed = await tx.supplierInvoice.findFirst({
                    where: {
                        supplierCustomerId: dto.supplierCustomerId,
                        invoiceNo: dto.invoiceNo,
                        invoiceSymbol: dto.invoiceSymbol ?? null,
                        status: { not: SupplierInvoiceStatus.VOID },
                    },
                    select: { id: true },
                })
                if (existed) throw new BadRequestException('INVOICE_DUPLICATE')

                const created = await tx.supplierInvoice.create({
                    data: {
                        supplierCustomerId: dto.supplierCustomerId,
                        purchaseOrderId: dto.purchaseOrderId ?? null,
                        invoiceNo: dto.invoiceNo,
                        invoiceSymbol: dto.invoiceSymbol ?? null,
                        invoiceTemplate: dto.invoiceTemplate ?? null,
                        invoiceDate: new Date(dto.invoiceDate),
                        status: SupplierInvoiceStatus.POSTED,
                        postedAt: new Date(),
                        note: dto.note ?? null,
                        totalAmount: null,

                        sourceFileId: dto.sourceFileId ?? null,
                        sourceFileUrl: dto.sourceFileUrl ?? null,
                        sourceFileName: dto.sourceFileName ?? null,
                        sourceFileChecksum: dto.sourceFileChecksum ?? null,

                        lines: {
                            create: dto.lines.map((l) => ({
                                supplierLocationId: l.supplierLocationId,
                                productId: l.productId,
                                qty: new Prisma.Decimal(l.qty),

                                tempC: l.tempC == null ? null : new Prisma.Decimal(l.tempC),
                                density: l.density == null ? null : new Prisma.Decimal(l.density),
                                standardQtyV15: l.standardQtyV15 == null ? null : new Prisma.Decimal(l.standardQtyV15),

                                unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                                taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),
                                discountAmount: new Prisma.Decimal(l.discountAmount ?? 0),

                                goodsReceiptId: l.goodsReceiptId ?? null,
                            })),
                        },
                    },
                    include: { lines: true },
                })

                for (const line of created.lines) {
                    const loc = await tx.supplierLocation.findUnique({
                        where: { id: line.supplierLocationId },
                        select: { supplierCustomerId: true },
                    })
                    if (!loc) throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_FOUND')
                    if (loc.supplierCustomerId !== created.supplierCustomerId) {
                        throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_BELONG_SUPPLIER')
                    }

                    if (line.goodsReceiptId) {
                        const gr = await tx.goodsReceipt.findUnique({
                            where: { id: line.goodsReceiptId },
                            select: {
                                id: true,
                                status: true,
                                supplierCustomerId: true,
                                supplierLocationId: true,
                                productId: true,
                            },
                        })
                        if (!gr) throw new BadRequestException('INVOICE_LINE_GR_NOT_FOUND')
                        if (gr.status !== 'CONFIRMED') {
                            throw new BadRequestException('INVOICE_LINE_GR_NOT_CONFIRMED')
                        }
                        if (gr.supplierCustomerId !== created.supplierCustomerId) {
                            throw new BadRequestException('INVOICE_LINE_GR_SUPPLIER_MISMATCH')
                        }
                        if (gr.supplierLocationId !== line.supplierLocationId) {
                            throw new BadRequestException('INVOICE_LINE_GR_LOCATION_MISMATCH')
                        }
                        if (gr.productId !== line.productId) {
                            throw new BadRequestException('INVOICE_LINE_GR_PRODUCT_MISMATCH')
                        }
                    }
                }

                // let total = new Prisma.Decimal(0)
                // for (const line of created.lines) {
                //     const qty = new Prisma.Decimal(line.qty)
                //     const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                //     total = total.plus(qty.mul(unitPrice))
                // }

                let total = new Prisma.Decimal(0)

                for (const line of created.lines) {
                    const qty = new Prisma.Decimal(line.qty)
                    const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                    const discountAmount = line.discountAmount ? new Prisma.Decimal(line.discountAmount) : new Prisma.Decimal(0)
                    const taxRate = line.taxRate ? new Prisma.Decimal(line.taxRate) : new Prisma.Decimal(0)

                    const netUnitPriceRaw = unitPrice.minus(discountAmount)
                    const netUnitPrice = netUnitPriceRaw.lessThan(0) ? new Prisma.Decimal(0) : netUnitPriceRaw

                    const lineNet = qty.mul(netUnitPrice)
                    const lineTax = lineNet.mul(taxRate).div(100)
                    const lineTotal = lineNet.plus(lineTax)

                    total = total.plus(lineTotal)
                }

                const settlement = await tx.supplierSettlement.create({
                    data: {
                        supplierCustomerId: created.supplierCustomerId,
                        type: SettlementType.PAYABLE,
                        status: SettlementStatus.OPEN,
                        amountTotal: total,
                        amountSettled: new Prisma.Decimal(0),
                        dueDate: null,
                        note: null,
                    },
                })

                const posted = await tx.supplierInvoice.update({
                    where: { id: created.id },
                    data: {
                        totalAmount: total,
                        payableSettlementId: settlement.id,
                    },
                    include: {
                        lines: true,
                        supplier: true,
                        payableSettlement: true,
                        purchaseOrder: true,
                    },
                })

                for (const line of posted.lines) {
                    await this.inventory.applyDeltaAndAppendLedger({
                        tx,
                        supplierLocationId: line.supplierLocationId,
                        productId: line.productId,
                        delta: {
                            deltaPendingDocQty: new Prisma.Decimal(line.qty).mul(-1),
                            deltaPostedQty: line.qty,
                        },
                        sourceType: InventoryLedgerSourceType.SUPPLIER_INVOICE,
                        sourceId: posted.id,
                        occurredAt: posted.invoiceDate,
                        note: dto.note ?? null,
                    })
                }

                return posted
            })
        } catch (e: any) {
            if (e?.code === 'INVENTORY_NEGATIVE_PENDING') {
                throw new BadRequestException('INVENTORY_NEGATIVE_PENDING')
            }
            if (e?.code === 'INVENTORY_NEGATIVE_POSTED') {
                throw new BadRequestException('INVENTORY_NEGATIVE_POSTED')
            }
            throw e
        }
    }

    async detail(id: string) {
        const inv = await this.prisma.supplierInvoice.findUnique({
            where: { id },
            include: {
                lines: {
                    include: {
                        product: true,
                        supplierLocation: true,
                    },
                },
                supplier: true,
                purchaseOrder: true,
                payableSettlement: true,
            },
        })
        if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
        return inv
    }

    async post(id: string, payload?: { note?: string }) {
        try {
            return await this.prisma.$transaction(async (tx) => {
                const inv = await tx.supplierInvoice.findUnique({
                    where: { id },
                    include: { lines: true },
                })
                if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
                if (inv.status !== SupplierInvoiceStatus.DRAFT) {
                    throw new BadRequestException('INVOICE_NOT_DRAFT')
                }

                for (const line of inv.lines) {
                    const loc = await tx.supplierLocation.findUnique({
                        where: { id: line.supplierLocationId },
                        select: { supplierCustomerId: true },
                    })
                    if (!loc) throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_FOUND')
                    if (loc.supplierCustomerId !== inv.supplierCustomerId) {
                        throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_BELONG_SUPPLIER')
                    }

                    if (line.goodsReceiptId) {
                        const gr = await tx.goodsReceipt.findUnique({
                            where: { id: line.goodsReceiptId },
                            select: {
                                id: true,
                                status: true,
                                supplierCustomerId: true,
                                supplierLocationId: true,
                                productId: true,
                            },
                        })
                        
                        if (!gr) throw new BadRequestException('INVOICE_LINE_GR_NOT_FOUND')
                        if (gr.status !== 'CONFIRMED') throw new BadRequestException('INVOICE_LINE_GR_NOT_CONFIRMED')
                        if (gr.supplierCustomerId !== inv.supplierCustomerId) {
                            throw new BadRequestException('INVOICE_LINE_GR_SUPPLIER_MISMATCH')
                        }
                        if (gr.supplierLocationId !== line.supplierLocationId) {
                            throw new BadRequestException('INVOICE_LINE_GR_LOCATION_MISMATCH')
                        }
                        if (gr.productId !== line.productId) {
                            throw new BadRequestException('INVOICE_LINE_GR_PRODUCT_MISMATCH')
                        }
                    }
                }

                // let total = new Prisma.Decimal(0)
                // for (const line of inv.lines) {
                //     const qty = new Prisma.Decimal(line.qty)
                //     const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                //     total = total.plus(qty.mul(unitPrice))
                // }

                let total = new Prisma.Decimal(0)

                for (const line of inv.lines) {
                    const qty = new Prisma.Decimal(line.qty)
                    const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                    const discountAmount = line.discountAmount ? new Prisma.Decimal(line.discountAmount) : new Prisma.Decimal(0)
                    const taxRate = line.taxRate ? new Prisma.Decimal(line.taxRate) : new Prisma.Decimal(0)

                    const netUnitPriceRaw = unitPrice.minus(discountAmount)
                    const netUnitPrice = netUnitPriceRaw.lessThan(0) ? new Prisma.Decimal(0) : netUnitPriceRaw

                    const lineNet = qty.mul(netUnitPrice)
                    const lineTax = lineNet.mul(taxRate).div(100)
                    const lineTotal = lineNet.plus(lineTax)

                    total = total.plus(lineTotal)
                }

                const settlement = await tx.supplierSettlement.create({
                    data: {
                        supplierCustomerId: inv.supplierCustomerId,
                        type: SettlementType.PAYABLE,
                        status: SettlementStatus.OPEN,
                        amountTotal: total,
                        amountSettled: new Prisma.Decimal(0),
                        dueDate: null,
                        note: null,
                    },
                })

                const posted = await tx.supplierInvoice.update({
                    where: { id: inv.id },
                    data: {
                        status: SupplierInvoiceStatus.POSTED,
                        postedAt: new Date(),
                        totalAmount: total,
                        note: payload?.note ?? inv.note,
                        payableSettlementId: settlement.id,
                    },
                    include: { lines: true, payableSettlement: true },
                })

                for (const line of posted.lines) {
                    await this.inventory.applyDeltaAndAppendLedger({
                        tx,
                        supplierLocationId: line.supplierLocationId,
                        productId: line.productId,
                        delta: {
                            deltaPendingDocQty: new Prisma.Decimal(line.qty).mul(-1),
                            deltaPostedQty: line.qty,
                        },
                        sourceType: InventoryLedgerSourceType.SUPPLIER_INVOICE,
                        sourceId: posted.id,
                        occurredAt: posted.invoiceDate,
                        note: payload?.note ?? null,
                    })
                }

                return posted
            })
        } catch (e: any) {
            if (e?.code === 'INVENTORY_NEGATIVE_PENDING') {
                throw new BadRequestException('INVENTORY_NEGATIVE_PENDING')
            }
            if (e?.code === 'INVENTORY_NEGATIVE_POSTED') {
                throw new BadRequestException('INVENTORY_NEGATIVE_POSTED')
            }
            throw e
        }
    }

    async void(id: string, payload?: { reason?: string }) {
        return this.prisma.$transaction(async (tx) => {
            const inv = await tx.supplierInvoice.findUnique({
                where: { id },
                include: { lines: true, payableSettlement: { include: { allocations: true } } },
            })
            if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
            if (inv.status !== SupplierInvoiceStatus.POSTED) throw new BadRequestException('INVOICE_NOT_POSTED')

            if (inv.payableSettlement?.allocations?.length) {
                throw new BadRequestException('SETTLEMENT_ALREADY_ALLOCATED')
            }

            const voided = await tx.supplierInvoice.update({
                where: { id: inv.id },
                data: { status: SupplierInvoiceStatus.VOID },
                include: { lines: true },
            })

            for (const line of voided.lines) {
                await this.inventory.applyDeltaAndAppendLedger({
                    tx,
                    supplierLocationId: line.supplierLocationId,
                    productId: line.productId,
                    delta: {
                        deltaPendingDocQty: line.qty,
                        deltaPostedQty: new Prisma.Decimal(line.qty).mul(-1),
                    },
                    sourceType: InventoryLedgerSourceType.SUPPLIER_INVOICE,
                    sourceId: voided.id,
                    occurredAt: new Date(),
                    note: payload?.reason ?? null,
                })
            }

            if (inv.payableSettlementId) {
                await tx.supplierSettlement.update({
                    where: { id: inv.payableSettlementId },
                    data: { status: 'VOID' },
                })
            }

            return voided
        })
    }
}
