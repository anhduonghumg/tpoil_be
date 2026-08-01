import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { GoodsReceiptPostingService } from '../../inventory/goods-receipt-posting.service'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'
import { GoogleDriveService } from 'src/infra/google-drive/google-drive.service'
import {
    BackgroundJobType,
    PartyRoleType,
    PayableEntryType,
    PayableOpenItemStatus,
    Prisma,
    SupplierInvoiceStatus,
    WarehousePartyRole,
} from '@prisma/client'
import * as crypto from 'node:crypto'
import { ARTIFACT_PDF_INPUT, ARTIFACT_PDF_PREVIEW, QB_SUPPLIER_INVOICE } from './jobs/supplier-invoice-queues'
import { CreateSupplierInvoiceDto } from './dto/supplier-invoice.dto'
import PdfParse from 'pdf-parse'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'

@Injectable()
export class SupplierInvoicesService {
    private readonly FAST_PATH_MAX_SIZE = 2 * 1024 * 1024 // 2MB

    constructor(
        private readonly prisma: PrismaService,
        private readonly receiptPosting: GoodsReceiptPostingService,
        private readonly bgJobs: BackgroundJobsService,
        private readonly artifacts: JobArtifactsService,
        private readonly drive: GoogleDriveService,
        private readonly notificationOutbox: NotificationOutboxService,
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

        const supplier = await this.prisma.party.findUnique({
            where: { id: args.supplierCustomerId },
            select: { id: true, name: true, roles: { where: { role: PartyRoleType.SUPPLIER, validTo: null }, select: { id: true } } },
        })
        if (!supplier) throw new BadRequestException('SUPPLIER_NOT_FOUND')
        if (!supplier.roles.length) throw new BadRequestException('NOT_SUPPLIER')

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

    private normalizeTaxRate(value?: number) {
        if (value == null) return new Prisma.Decimal(0)
        const rate = new Prisma.Decimal(value)
        return rate.greaterThan(1) ? rate.div(100) : rate
    }

    async create(dto: CreateSupplierInvoiceDto) {
        const invoiceId = await this.prisma.$transaction(async (tx) => {
            const supplier = await tx.party.findUnique({
                where: { id: dto.supplierCustomerId },
                select: {
                    id: true,
                    roles: { where: { role: PartyRoleType.SUPPLIER, validTo: null }, select: { id: true } },
                },
            })
            if (!supplier) throw new BadRequestException('SUPPLIER_NOT_FOUND')
            if (!supplier.roles.length) throw new BadRequestException('NOT_SUPPLIER')

            if (dto.purchaseOrderId) {
                const po = await tx.purchaseOrder.findUnique({
                    where: { id: dto.purchaseOrderId },
                    select: { supplierCustomerId: true },
                })
                if (!po) throw new BadRequestException('PURCHASE_ORDER_NOT_FOUND')
                if (po.supplierCustomerId !== dto.supplierCustomerId) {
                    throw new BadRequestException('PO_SUPPLIER_MISMATCH')
                }
            }

            const preparedLines: Prisma.SupplierInvoiceLineCreateWithoutInvoiceInput[] = []
            let legalEntityId: string | null = null
            let totalAmount = new Prisma.Decimal(0)

            for (const [index, input] of dto.lines.entries()) {
                const warehouse = await tx.warehouse.findUnique({
                    where: { id: input.supplierLocationId },
                    select: {
                        legalEntityId: true,
                        parties: {
                            where: {
                                partyId: dto.supplierCustomerId,
                                role: WarehousePartyRole.OPERATOR,
                                validTo: null,
                            },
                            select: { id: true },
                        },
                    },
                })
                if (!warehouse) throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_FOUND')
                if (!warehouse.parties.length) {
                    throw new BadRequestException('INVOICE_LINE_LOCATION_NOT_BELONG_SUPPLIER')
                }
                if (legalEntityId && legalEntityId !== warehouse.legalEntityId) {
                    throw new BadRequestException('INVOICE_LINES_MUST_BELONG_TO_ONE_LEGAL_ENTITY')
                }
                legalEntityId = warehouse.legalEntityId

                let receiptLineId: string | null = null
                if (input.goodsReceiptId) {
                    const receiptLine = await tx.goodsReceiptLine.findFirst({
                        where: { goodsReceiptId: input.goodsReceiptId, productId: input.productId },
                        include: { goodsReceipt: true },
                    })
                    if (!receiptLine) throw new BadRequestException('INVOICE_LINE_GR_NOT_FOUND')
                    if (receiptLine.goodsReceipt.status !== 'CONFIRMED') {
                        throw new BadRequestException('INVOICE_LINE_GR_NOT_CONFIRMED')
                    }
                    if (receiptLine.goodsReceipt.supplierCustomerId !== dto.supplierCustomerId) {
                        throw new BadRequestException('INVOICE_LINE_GR_SUPPLIER_MISMATCH')
                    }
                    if (receiptLine.goodsReceipt.warehouseId !== input.supplierLocationId) {
                        throw new BadRequestException('INVOICE_LINE_GR_LOCATION_MISMATCH')
                    }
                    const allocated = await tx.supplierInvoiceLine.aggregate({
                        where: {
                            receiptLineId: receiptLine.id,
                            invoice: { status: { not: SupplierInvoiceStatus.VOIDED } },
                        },
                        _sum: { actualQty: true },
                    })
                    if (
                        new Prisma.Decimal(allocated._sum.actualQty ?? 0)
                            .plus(input.qty)
                            .greaterThan(receiptLine.actualQty)
                    ) {
                        throw new BadRequestException('INVOICE_QTY_EXCEEDS_RECEIPT_QTY')
                    }
                    receiptLineId = receiptLine.id
                }

                const purchaseOrderLine = dto.purchaseOrderId
                    ? await tx.purchaseOrderLine.findFirst({
                          where: { purchaseOrderId: dto.purchaseOrderId, productId: input.productId },
                          select: { id: true },
                      })
                    : null
                const qty = new Prisma.Decimal(input.qty)
                const unitPrice = new Prisma.Decimal(input.unitPrice ?? 0)
                const discountPerUnit = new Prisma.Decimal(input.discountAmount ?? 0)
                const netUnitPrice = Prisma.Decimal.max(unitPrice.minus(discountPerUnit), 0)
                const netAmount = qty.mul(netUnitPrice)
                const taxRate = this.normalizeTaxRate(input.taxRate)
                const taxAmount = netAmount.mul(taxRate)
                totalAmount = totalAmount.plus(netAmount).plus(taxAmount)
                preparedLines.push({
                    lineNo: index + 1,
                    product: { connect: { id: input.productId } },
                    ...(purchaseOrderLine
                        ? { purchaseOrderLine: { connect: { id: purchaseOrderLine.id } } }
                        : {}),
                    ...(receiptLineId ? { receiptLine: { connect: { id: receiptLineId } } } : {}),
                    actualQty: qty,
                    unitPrice,
                    netAmount,
                    taxRate,
                    taxAmount,
                })
            }
            if (!legalEntityId) throw new BadRequestException('INVOICE_LEGAL_ENTITY_NOT_FOUND')

            const duplicate = await tx.supplierInvoice.findFirst({
                where: {
                    legalEntityId,
                    supplierCustomerId: dto.supplierCustomerId,
                    invoiceNo: dto.invoiceNo.trim(),
                    invoiceSymbol: dto.invoiceSymbol?.trim() || '',
                },
                select: { id: true },
            })
            if (duplicate) throw new BadRequestException('INVOICE_DUPLICATE')

            const invoice = await tx.supplierInvoice.create({
                data: {
                    legalEntityId,
                    supplierCustomerId: dto.supplierCustomerId,
                    purchaseOrderId: dto.purchaseOrderId ?? null,
                    invoiceNo: dto.invoiceNo.trim(),
                    invoiceSymbol: dto.invoiceSymbol?.trim() || '',
                    invoiceTemplate: dto.invoiceTemplate?.trim() || null,
                    invoiceDate: new Date(dto.invoiceDate),
                    totalAmount,
                    note: dto.note?.trim() || null,
                    sourceFileId: dto.sourceFileId ?? null,
                    sourceFileUrl: dto.sourceFileUrl ?? null,
                    sourceFileName: dto.sourceFileName ?? null,
                    sourceFileChecksum: dto.sourceFileChecksum ?? null,
                    lines: { create: preparedLines },
                },
                include: { lines: true },
            })
            // A received lot invoice is immediately visible in business/accounting inventory.
            await this.postCommercialLotInvoice(tx, invoice)
            return invoice.id
        })
        return this.detail(invoiceId)
    }

    async detail(id: string) {
        const inv = await this.prisma.supplierInvoice.findUnique({
            where: { id },
            include: {
                supplier: true,
                legalEntity: true,
                purchaseOrder: true,
                openItem: { include: { allocations: true, entries: true } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: true,
                        purchaseOrderLine: { include: { receivingWarehouse: true } },
                        receiptLine: {
                            include: {
                                goodsReceipt: { include: { warehouse: true } },
                            },
                        },
                    },
                },
            },
        })
        if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
        const payableSettlement = inv.openItem
            ? {
                  ...inv.openItem,
                  supplierCustomerId: inv.openItem.supplierPartyId,
                  type: inv.openItem.settlementType,
                  amountTotal: inv.openItem.originalAmount,
                  amountSettled: inv.openItem.originalAmount.minus(inv.openItem.outstandingAmount),
                  status:
                      inv.openItem.status === PayableOpenItemStatus.PARTIALLY_SETTLED
                          ? 'PARTIAL'
                          : inv.openItem.status === PayableOpenItemStatus.VOIDED
                            ? 'VOID'
                            : inv.openItem.status,
              }
            : null
        return {
            ...inv,
            status: inv.status === SupplierInvoiceStatus.VOIDED ? 'VOID' : inv.status,
            payableSettlementId: inv.openItem?.id ?? null,
            payableSettlement,
            lines: inv.lines.map((line) => {
                const receipt = line.receiptLine?.goodsReceipt
                const supplierLocation = receipt?.warehouse ?? line.purchaseOrderLine?.receivingWarehouse ?? null
                return {
                    ...line,
                    supplierLocationId: supplierLocation?.id ?? null,
                    supplierLocation,
                    qty: line.actualQty,
                    standardQtyV15: line.receiptLine?.v15Qty ?? null,
                    tempC: line.receiptLine?.temperatureC ?? null,
                    density: line.receiptLine?.density ?? null,
                    discountAmount: new Prisma.Decimal(0),
                    taxRate: line.taxRate.mul(100),
                    goodsReceiptId: line.receiptLine?.goodsReceiptId ?? null,
                }
            }),
        }
    }

    private async postCommercialLotInvoice(tx: Prisma.TransactionClient, invoice: any) {
        if (!invoice.purchaseOrderId) return
        const purchaseOrder = await tx.purchaseOrder.findUnique({
            where: { id: invoice.purchaseOrderId },
            select: {
                id: true,
                orderType: true,
                supplierCustomerId: true,
                status: true,
            },
        })
        if (!purchaseOrder || purchaseOrder.orderType !== 'LOT') return

        for (const invoiceLine of invoice.lines) {
            if (!invoiceLine.purchaseOrderLineId || invoiceLine.actualQty == null) {
                throw new BadRequestException('LOT_INVOICE_LINE_MUST_MATCH_PURCHASE_ORDER_LINE')
            }
            const existingAllocation = await tx.commercialLotInvoiceAllocation.findUnique({
                where: { supplierInvoiceLineId: invoiceLine.id },
                select: { id: true },
            })
            if (existingAllocation) continue

            const purchaseOrderLine = await tx.purchaseOrderLine.findUnique({
                where: { id: invoiceLine.purchaseOrderLineId },
                select: {
                    id: true,
                    purchaseOrderId: true,
                    productId: true,
                    receivingWarehouseId: true,
                    orderedQty: true,
                },
            })
            if (!purchaseOrderLine || purchaseOrderLine.purchaseOrderId !== purchaseOrder.id) {
                throw new BadRequestException('LOT_INVOICE_LINE_PO_MISMATCH')
            }
            if (!purchaseOrderLine.receivingWarehouseId) {
                throw new BadRequestException('LOT_PLANNED_WAREHOUSE_REQUIRED')
            }

            const position = await tx.commercialLotPosition.upsert({
                where: { purchaseOrderLineId: purchaseOrderLine.id },
                create: {
                    purchaseOrderLineId: purchaseOrderLine.id,
                    supplierCustomerId: purchaseOrder.supplierCustomerId,
                    plannedWarehouseId: purchaseOrderLine.receivingWarehouseId,
                    productId: purchaseOrderLine.productId,
                },
                update: {},
            })
            const qty = new Prisma.Decimal(invoiceLine.actualQty)
            const nextInvoicedQty = position.invoicedQty.plus(qty)
            if (nextInvoicedQty.greaterThan(purchaseOrderLine.orderedQty)) {
                throw new BadRequestException({
                    code: 'LOT_INVOICE_QTY_EXCEEDS_ORDERED_QTY',
                    message: 'Tổng lượng hóa đơn không được vượt số lượng đặt mua.',
                })
            }

            await tx.commercialLotInvoiceAllocation.create({
                data: {
                    commercialLotPositionId: position.id,
                    supplierInvoiceLineId: invoiceLine.id,
                    qty,
                    accountingValue: invoiceLine.netAmount,
                },
            })
            await tx.commercialLotPosition.update({
                where: { id: position.id },
                data: {
                    invoicedQty: { increment: qty },
                    accountingValue: { increment: invoiceLine.netAmount },
                    version: { increment: 1 },
                },
            })
        }

        if (purchaseOrder.status === 'APPROVED') {
            await tx.purchaseOrder.update({
                where: { id: purchaseOrder.id },
                data: { status: 'IN_PROGRESS', version: { increment: 1 } },
            })
        }
    }

    async post(id: string, payload?: { note?: string }, actorId?: string | null) {
        await this.prisma.$transaction(async (tx) => {
            const inv = await tx.supplierInvoice.findUnique({
                where: { id },
                include: {
                    lines: { include: { receiptLine: true } },
                    openItem: true,
                    purchaseOrder: {
                        select: { id: true, orderNo: true, orderType: true, createdById: true },
                    },
                },
            })
            if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
            if (inv.status === SupplierInvoiceStatus.POSTED && inv.openItem) return
            if (inv.status !== SupplierInvoiceStatus.DRAFT) throw new BadRequestException('INVOICE_NOT_DRAFT')

            const now = new Date()
            const updated = await tx.supplierInvoice.updateMany({
                where: { id, status: SupplierInvoiceStatus.DRAFT, version: inv.version },
                data: {
                    status: SupplierInvoiceStatus.POSTED,
                    postedAt: now,
                    note: payload?.note ?? inv.note,
                    version: { increment: 1 },
                },
            })
            if (updated.count !== 1) throw new BadRequestException('INVOICE_CONCURRENTLY_CHANGED')

            await tx.payableOpenItem.create({
                data: {
                    supplierInvoiceId: inv.id,
                    legalEntityId: inv.legalEntityId,
                    supplierPartyId: inv.supplierCustomerId,
                    currency: inv.currency,
                    originalAmount: inv.totalAmount,
                    outstandingAmount: inv.totalAmount,
                    entries: {
                        create: {
                            type: PayableEntryType.OPEN,
                            amountDelta: inv.totalAmount,
                            idempotencyKey: `invoice:${inv.id}:open`,
                            effectiveAt: now,
                        },
                    },
                },
            })
            await this.postCommercialLotInvoice(tx, inv)
            const receiptIds = [
                ...new Set(inv.lines.map((line) => line.receiptLine?.goodsReceiptId).filter(Boolean)),
            ] as string[]
            for (const goodsReceiptId of receiptIds) {
                await this.receiptPosting.releasePendingForInvoice(tx, {
                    goodsReceiptId,
                    occurredAt: now,
                })
            }
            if (inv.purchaseOrder?.orderType === 'LOT') {
                await this.notificationOutbox.emit(
                    {
                        eventType: PURCHASE_NOTIFICATION_EVENTS.INVOICE_POSTED,
                        aggregateType: 'COMMERCIAL_PURCHASE_INVOICE',
                        aggregateId: inv.id,
                        dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.INVOICE_POSTED}:${inv.id}`,
                        payload: {
                            entityType: 'COMMERCIAL_PURCHASE',
                            entityId: inv.purchaseOrder.id,
                            orderNo: inv.purchaseOrder.orderNo,
                            invoiceNo: inv.invoiceNo,
                            recipientUserIds: inv.purchaseOrder.createdById
                                ? [inv.purchaseOrder.createdById]
                                : [],
                            recipientPermissionPrefixes: ['purchases.'],
                            excludeUserIds: actorId ? [actorId] : [],
                        },
                    },
                    tx,
                )
            }
        })
        return this.detail(id)
    }

    async void(id: string, payload?: { reason?: string }) {
        await this.prisma.$transaction(async (tx) => {
            const inv = await tx.supplierInvoice.findUnique({
                where: { id },
                include: {
                    lines: {
                        include: {
                            receiptLine: true,
                            commercialLotAllocation: { include: { commercialLotPosition: true } },
                        },
                    },
                    openItem: { include: { allocations: { where: { status: 'ACTIVE' } } } },
                },
            })
            if (!inv) throw new NotFoundException('INVOICE_NOT_FOUND')
            if (inv.status !== SupplierInvoiceStatus.POSTED) throw new BadRequestException('INVOICE_NOT_POSTED')
            if (inv.openItem?.allocations.length) throw new BadRequestException('SETTLEMENT_ALREADY_ALLOCATED')

            const now = new Date()
            for (const line of inv.lines) {
                const allocation = line.commercialLotAllocation
                if (!allocation) continue
                const position = allocation.commercialLotPosition
                const remainingInvoiced = position.invoicedQty.minus(allocation.qty)
                if (position.withdrawnQty.greaterThan(remainingInvoiced)) {
                    throw new BadRequestException({
                        code: 'LOT_INVOICE_ALREADY_WITHDRAWN',
                        message: 'Không thể hủy hóa đơn vì hàng của hóa đơn đã được rút.',
                    })
                }
                await tx.commercialLotInvoiceAllocation.delete({ where: { id: allocation.id } })
                await tx.commercialLotPosition.update({
                    where: { id: position.id },
                    data: {
                        invoicedQty: { decrement: allocation.qty },
                        accountingValue: { decrement: allocation.accountingValue },
                        version: { increment: 1 },
                    },
                })
            }
            if (inv.openItem) {
                await tx.payableLedgerEntry.create({
                    data: {
                        openItemId: inv.openItem.id,
                        type: PayableEntryType.REVERSAL,
                        amountDelta: inv.openItem.outstandingAmount.negated(),
                        idempotencyKey: `invoice:${inv.id}:void`,
                        effectiveAt: now,
                    },
                })
                await tx.payableOpenItem.update({
                    where: { id: inv.openItem.id },
                    data: {
                        outstandingAmount: 0,
                        status: PayableOpenItemStatus.VOIDED,
                        version: { increment: 1 },
                    },
                })
            }
            await tx.supplierInvoice.update({
                where: { id: inv.id },
                data: {
                    status: SupplierInvoiceStatus.VOIDED,
                    note: payload?.reason ?? inv.note,
                    version: { increment: 1 },
                },
            })
            const receiptIds = [
                ...new Set(inv.lines.map((line) => line.receiptLine?.goodsReceiptId).filter(Boolean)),
            ] as string[]
            for (const goodsReceiptId of receiptIds) {
                await this.receiptPosting.restorePendingForVoidedInvoice(tx, {
                    goodsReceiptId,
                    occurredAt: now,
                })
            }
        })
        return this.detail(id)
    }
}
