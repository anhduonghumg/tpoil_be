import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryService } from '../../inventory/inventory.service'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'
import { GoogleDriveService } from 'src/infra/google-drive/google-drive.service'
import { BackgroundJobType, SupplierInvoiceStatus, SettlementType, SettlementStatus, InventoryLedgerSourceType, Prisma } from '@prisma/client'
import * as crypto from 'node:crypto'
import { ARTIFACT_PDF_INPUT, ARTIFACT_PDF_PREVIEW, QB_SUPPLIER_INVOICE } from './jobs/supplier-invoice-queues'

@Injectable()
export class SupplierInvoicesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryService,

        private readonly bgJobs: BackgroundJobsService,
        private readonly artifacts: JobArtifactsService,
        private readonly drive: GoogleDriveService,
    ) {}

    async previewPdfImport(args: { supplierCustomerId: string; file: Express.Multer.File }) {
        if (!args.file?.buffer?.length) throw new BadRequestException('File is required (multipart field "file")')

        const supplier = await this.prisma.customer.findUnique({
            where: { id: args.supplierCustomerId },
            select: { id: true, code: true, name: true, isSupplier: true },
        })
        if (!supplier) throw new BadRequestException('Supplier not found')
        if (!supplier.isSupplier) throw new BadRequestException('Party is not marked as Supplier')

        const checksum = crypto.createHash('sha256').update(args.file.buffer).digest('hex')

        const uploaded = await this.drive.uploadPdf({
            buffer: args.file.buffer,
            fileName: args.file.originalname,
        })

        const run = await this.bgJobs.createRun({
            type: BackgroundJobType.SUPPLIER_INVOICE_IMPORT_PDF,
            name: 'Import Supplier Invoice PDF (preview)',
            payload: { supplierCustomerId: supplier.id, checksum, driveFileId: uploaded.fileId },
        })

        await this.artifacts.upsertArtifact({
            runId: run.id,
            kind: ARTIFACT_PDF_INPUT,
            content: {
                supplierCustomerId: supplier.id,
                supplierName: supplier.name,
                fileId: uploaded.fileId,
                fileName: uploaded.fileName,
                mimeType: uploaded.mimeType,
                checksum,
            },
            fileUrl: uploaded.webViewLink ?? '',
            checksum,
        })

        await this.bgJobs.enqueueRun({
            type: BackgroundJobType.SUPPLIER_INVOICE_IMPORT_PDF,
            queueName: QB_SUPPLIER_INVOICE,
            runId: run.id,
            profile: 'pdf_parse',
        })

        return {
            runId: run.id,
            fileId: uploaded.fileId,
            fileUrl: uploaded.webViewLink ?? null,
            checksum,
            status: 'QUEUED',
        }
    }

    async getPreviewResult(runId: string) {
        const run = await this.prisma.backgroundJobRun.findUnique({
            where: { id: runId },
            select: { id: true, status: true, error: true, metrics: true },
        })
        if (!run) throw new BadRequestException('Run not found')

        const input = await this.artifacts.getArtifact(runId, ARTIFACT_PDF_INPUT)
        const preview = await this.artifacts.getArtifact(runId, ARTIFACT_PDF_PREVIEW)

        return {
            runId,
            status: run.status,
            error: run.error ?? null,
            metrics: run.metrics ?? null,
            input: input?.content ?? null,
            preview: preview?.content ?? null,
            fileUrl: input?.fileUrl ?? null,
        }
    }

    async handleWorkerJob(runId: string) {
        await this.bgJobs.markProcessing(runId)

        try {
            const input = await this.artifacts.getArtifact(runId, ARTIFACT_PDF_INPUT)
            if (!input?.content) throw new Error('Missing PDF input artifact')

            const data = (input.content ?? {}) as {
                supplierCustomerId?: string
                fileId?: string
                fileName?: string
            }
            const fileId = data.fileId as string
            if (!fileId) throw new Error('Missing fileId')

            const preview = {
                detected: {
                    supplierCustomerId: data.supplierCustomerId ?? null,
                    invoiceNo: null,
                    invoiceSymbol: null,
                    invoiceDate: null,
                    totalAmount: null,
                },
                suggestedLines: [],
                warnings: ['PDF preview parser not enabled yet. This is a skeleton preview.'],
            }

            await this.artifacts.upsertArtifact({
                runId,
                kind: ARTIFACT_PDF_PREVIEW,
                fileUrl: input.fileUrl as string,
                content: preview,
                checksum: input.checksum ?? undefined,
            })

            await this.bgJobs.markSuccess(runId, { preview: true })
            return { ok: true }
        } catch (err) {
            await this.bgJobs.markFailed(runId, err)
            return { ok: false }
        }
    }

    async create(dto: {
        supplierCustomerId: string
        invoiceNo: string
        invoiceSymbol: string
        invoiceTemplate?: string
        invoiceDate: string
        note?: string
        lines: Array<{
            supplierLocationId: string
            productId: string
            qty: number
            tempC?: number
            density?: number
            standardQtyV15?: number
            unitPrice?: number
            taxRate?: number
            goodsReceiptId?: string
        }>
    }) {
        return this.prisma.supplierInvoice.create({
            data: {
                supplierCustomerId: dto.supplierCustomerId,
                invoiceNo: dto.invoiceNo,
                invoiceSymbol: dto.invoiceSymbol,
                invoiceTemplate: dto.invoiceTemplate ?? null,
                invoiceDate: new Date(dto.invoiceDate),
                status: SupplierInvoiceStatus.DRAFT,
                note: dto.note ?? null,
                totalAmount: null,

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

                        goodsReceiptId: l.goodsReceiptId ?? null,
                    })),
                },
            },
            include: { lines: true },
        })
    }

    async detail(id: string) {
        const inv = await this.prisma.supplierInvoice.findUnique({
            where: { id },
            include: { lines: true, supplier: true, payableSettlement: true },
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

                // 1) compute totalAmount (simple: sum qty*unitPrice; tax xử lý tuỳ bạn)
                let total = new Prisma.Decimal(0)
                for (const line of inv.lines) {
                    const qty = new Prisma.Decimal(line.qty)
                    const unitPrice = line.unitPrice ? new Prisma.Decimal(line.unitPrice) : new Prisma.Decimal(0)
                    total = total.plus(qty.mul(unitPrice))
                }

                // 2) create settlement PAYABLE (1 invoice -> 1 settlement, clean)
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

                // 3) update invoice -> POSTED + link settlement
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

                // 4) Inventory move: Pending -> Posted, append ledger per line
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

            // mark invoice VOID
            const voided = await tx.supplierInvoice.update({
                where: { id: inv.id },
                data: { status: SupplierInvoiceStatus.VOID },
                include: { lines: true },
            })

            // reverse inventory posted -> pending
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

            // void settlement (since no allocations)
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
