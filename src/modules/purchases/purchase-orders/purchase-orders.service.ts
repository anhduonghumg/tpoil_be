// src/modules/purchases/purchase-orders/purchase-orders.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { BackgroundJobStatus, Prisma, PurchaseOrderStatus, SupplierInvoiceStatus } from '@prisma/client'
import { ContractCheckService } from './contract-check.service'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PaymentTermType } from './dto/purchase-order.dto'
import { BackgroundJobsService } from 'src/modules/background-jobs/background-jobs.service'
import { JobArtifactsService } from 'src/modules/job-artifacts/job-artifacts.service'
import { CreatePurchaseOrderPrintBatchDto } from './dto/create-purchase-order-print-batch.dto'
import { ARTIFACT_PO_PRINT_INPUT, ARTIFACT_PO_PRINT_OUTPUT } from './constants/purchase-order.constants'
import { PURCHASE_ORDER_PRINT_JOB_NAME, PURCHASE_ORDER_PRINT_JOB_TYPE, QB_PURCHASE_ORDER_PRINT } from './jobs/purchase-order-print-queues'
import { PurchaseOrderPrintBatchInput, PurchaseOrderPrintData } from './types/purchase-order-print.types'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { PDFDocument } from 'pdf-lib'
import * as fs from 'fs/promises'
import * as archiver from 'archiver'
import * as path from 'path'
import * as puppeteer from 'puppeteer-core'
import { renderPurchaseOrderPrintHtml } from './templates/purchase-order-print.template'

@Injectable()
export class PurchaseOrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly contractCheck: ContractCheckService,
        private readonly backgroundJobsService: BackgroundJobsService,
        private readonly jobArtifactsService: JobArtifactsService,
    ) {}

    private async resolveCustomerAddressAtDate(customerId: string, at: Date): Promise<string | null> {
        const d = new Date(at)
        d.setHours(0, 0, 0, 0)

        const row = await this.prisma.customerAddress.findFirst({
            where: {
                customerId,
                validFrom: { lte: d },
                OR: [{ validTo: null }, { validTo: { gte: d } }],
            },
            orderBy: [{ validFrom: 'desc' }, { createdAt: 'desc' }],
            select: { addressLine: true },
        })

        return this.normalizeText(row?.addressLine)
    }

    private normalizeText(value?: string | null): string | null {
        const s = String(value ?? '').trim()
        return s ? s : null
    }

    private formatDate(value: Date | string): string {
        const d = new Date(value)
        const dd = String(d.getDate()).padStart(2, '0')
        const mm = String(d.getMonth() + 1).padStart(2, '0')
        const yyyy = d.getFullYear()
        return `${dd}/${mm}/${yyyy}`
    }

    private mapPaymentModeText(paymentMode: string): string {
        switch (paymentMode) {
            case 'PREPAID':
                return 'Thanh toán trước'
            case 'POSTPAID':
                return 'Thanh toán sau'
            default:
                return paymentMode
        }
    }

    private resolvePaymentDeadlineText(po: { paymentTermDays?: number | null; paymentTermType?: string | null }): string {
        if (po.paymentTermDays && po.paymentTermDays > 0) {
            return `${po.paymentTermDays} ngày`
        }

        switch (po.paymentTermType) {
            case 'SAME_DAY':
                return 'Trong ngày'
            case 'NEXT_DAY':
                return 'Ngày hôm sau'
            default:
                return ''
        }
    }

    private normalizeDateOnly(s: string) {
        const d = new Date(s)
        if (Number.isNaN(d.getTime())) throw new BadRequestException('INVALID_DATE')
        return d
    }

    private toDateOrThrow(value: string, code: string) {
        const d = new Date(value)
        if (Number.isNaN(d.getTime())) throw new BadRequestException(code)
        return d
    }

    private async zipFiles(workDir: string, pdfDir: string, outPath: string, includeErrorsTxt: boolean): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            const output = createWriteStream(outPath)
            const archive = archiver('zip', { zlib: { level: 9 } })

            output.on('close', () => resolve())
            output.on('error', (err) => reject(err))
            archive.on('error', (err) => reject(err))

            archive.pipe(output)
            archive.directory(pdfDir, false)

            if (includeErrorsTxt) {
                archive.file(path.join(workDir, 'errors.txt'), { name: 'errors.txt' })
            }

            archive.finalize()
        })
    }

    private buildErrorsText(errors: Array<{ id: string; orderNo?: string; message: string }>): string {
        const lines: string[] = []
        lines.push('DANH SÁCH ĐƠN IN LỖI')
        lines.push('')

        for (const err of errors) {
            lines.push(`${err.orderNo || err.id} - ${err.message}`)
        }

        return lines.join('\n')
    }

    private toSafeFileName(value: string): string {
        return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').trim() || 'purchase-order'
    }

    private toErrorMessage(error: unknown): string {
        if (error instanceof Error) return error.message
        return String(error)
    }

    private async sha256File(filePath: string): Promise<string> {
        const buf = await fs.readFile(filePath)
        return createHash('sha256').update(buf).digest('hex')
    }

    private async assertLocationsBelongToSupplier(args: { supplierCustomerId: string; locationIds: string[] }) {
        const { supplierCustomerId, locationIds } = args
        if (!locationIds.length) return

        const rows = await this.prisma.supplierLocation.findMany({
            where: {
                id: { in: locationIds },
                supplierCustomerId,
                isActive: true,
            },
            select: { id: true },
        })

        const ok = new Set(rows.map((x) => x.id))
        const bad = locationIds.filter((id) => !ok.has(id))
        if (bad.length) {
            throw new BadRequestException({
                code: 'SUPPLIER_LOCATION_INVALID',
                message: 'Kho NCC không hợp lệ hoặc không thuộc NCC đã chọn.',
                invalidLocationIds: bad,
            })
        }
    }

    private buildPoSummary(item: any) {
        const confirmedReceiptCount = item.receipts?.length ?? 0
        const hasReceipt = confirmedReceiptCount > 0

        const invoices = item.supplierInvoices ?? []
        const hasInvoice = invoices.length > 0

        const settlementMap = new Map<string, any>()
        for (const inv of invoices) {
            const st = inv.payableSettlement
            if (st?.id) settlementMap.set(st.id, st)
        }

        const settlements = Array.from(settlementMap.values())

        const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s.amountTotal ?? 0), 0)

        const totalSettledAmount = settlements.reduce((sum, s) => sum + Number(s.amountSettled ?? 0), 0)

        const allSettled = settlements.length > 0 && settlements.every((s) => s.status === 'SETTLED')

        let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID'

        if (allSettled) {
            paymentStatus = 'PAID'
        } else if (totalSettledAmount > 0) {
            paymentStatus = 'PARTIALLY_PAID'
        }

        const orderedQtyTotal = (item.lines ?? []).reduce((sum: number, l: any) => sum + Number(l.orderedQty ?? 0), 0)

        const receivedQtyTotal = (item.receipts ?? []).reduce((sum: number, r: any) => sum + Number(r.qty ?? 0), 0)

        const remainingQty = Math.max(orderedQtyTotal - receivedQtyTotal, 0)

        const canReceive =
            item.status !== 'CANCELLED' &&
            item.status !== 'COMPLETED' &&
            !hasInvoice &&
            (item.orderType === 'LOT' ? remainingQty > 0 : confirmedReceiptCount === 0 && remainingQty > 0)

        const businessStatus =
            item.status === 'CANCELLED'
                ? 'CANCELLED'
                : paymentStatus === 'PAID'
                  ? 'PAID'
                  : paymentStatus === 'PARTIALLY_PAID'
                    ? 'PARTIALLY_PAID'
                    : hasInvoice
                      ? 'INVOICED'
                      : hasReceipt
                        ? 'RECEIVED'
                        : item.status === 'APPROVED' || item.status === 'IN_PROGRESS'
                          ? 'APPROVED'
                          : 'DRAFT'

        return {
            hasReceipt,
            hasInvoice,
            paymentStatus,
            businessStatus,
            orderedQtyTotal,
            receivedQtyTotal,
            remainingQty,
            canReceive,
            totalSettlementAmount,
            totalSettledAmount,
        }
    }

    private matchBusinessState(item: any, state?: string) {
        if (!state) return true

        const s = item.summary
        const status = item.status

        switch (state) {
            case 'PENDING_APPROVAL':
                return status === 'DRAFT'

            case 'PENDING_RECEIPT':
                return status !== 'DRAFT' && status !== 'CANCELLED' && status !== 'COMPLETED' && !s.hasReceipt && !s.hasInvoice

            case 'PENDING_INVOICE':
                return s.hasReceipt && !s.hasInvoice

            case 'PENDING_PAYMENT':
                return s.hasInvoice && s.paymentStatus !== 'PAID'

            case 'PAID':
                return s.paymentStatus === 'PAID'

            case 'CANCELLED':
                return status === 'CANCELLED'

            default:
                return true
        }
    }

    async create(dto: {
        orderNo: string
        supplierCustomerId: string
        supplierLocationId?: string
        orderType: any
        paymentMode: any
        paymentTermType: PaymentTermType
        paymentTermDays?: number
        allowPartialPayment?: boolean
        orderDate: string
        expectedDate?: string
        note?: string
        totalQty?: number
        totalAmount?: number
        paymentPlans?: Array<{
            dueDate: string
            amount: number
            note?: string
            sortOrder?: number
        }>
        lines: Array<{
            productId: string
            orderedQty: number
            supplierLocationId?: string
            discountAmount?: number
            unitPrice?: number
            taxRate?: number
        }>
    }) {
        const orderNo = (dto.orderNo ?? '').trim()
        if (!orderNo) throw new BadRequestException('ORDER_NO_REQUIRED')

        const orderDate = this.toDateOrThrow(dto.orderDate, 'ORDER_DATE_INVALID')
        const expectedDate = dto.expectedDate ? this.toDateOrThrow(dto.expectedDate, 'EXPECTED_DATE_INVALID') : null

        const paymentTermType = dto.paymentTermType ?? PaymentTermType.SAME_DAY
        const allowPartialPayment = dto.allowPartialPayment ?? true

        let paymentTermDays: number | null = dto.paymentTermDays ?? null
        if (paymentTermType === PaymentTermType.NET_DAYS) {
            if (!paymentTermDays || paymentTermDays <= 0) {
                throw new BadRequestException('PAYMENT_TERM_DAYS_REQUIRED')
            }
        } else {
            paymentTermDays = null
        }

        const rawPaymentPlans = Array.isArray(dto.paymentPlans) ? dto.paymentPlans : []

        const paymentPlans =
            dto.paymentMode === 'POSTPAID'
                ? rawPaymentPlans
                      .map((p, index) => ({
                          dueDate: this.toDateOrThrow(p.dueDate, 'PAYMENT_PLAN_DUE_DATE_INVALID'),
                          amount: Number(p.amount) || 0,
                          note: p.note?.trim() || null,
                          sortOrder: p.sortOrder ?? index,
                      }))
                      .filter((p) => p.amount > 0)
                : []

        if (dto.paymentMode === 'POSTPAID') {
            if (!paymentPlans.length) {
                throw new BadRequestException('PAYMENT_PLANS_REQUIRED')
            }

            for (const p of paymentPlans) {
                if (p.dueDate.getTime() < orderDate.getTime()) {
                    throw new BadRequestException('PAYMENT_PLAN_DUE_DATE_BEFORE_ORDER_DATE')
                }
            }
        }

        const rawLines = Array.isArray(dto.lines) ? dto.lines : []
        if (!rawLines.length) throw new BadRequestException('LINES_REQUIRED')

        const lines = rawLines
            .map((l) => ({
                productId: l.productId,
                orderedQty: Number(l.orderedQty) || 0,
                supplierLocationId: l.supplierLocationId ?? undefined,
                discountAmount: l.discountAmount == null ? 0 : Number(l.discountAmount) || 0,
                unitPrice: l.unitPrice == null ? null : Number(l.unitPrice),
                taxRate: l.taxRate == null ? null : Number(l.taxRate),
            }))
            .filter((l) => Boolean(l.productId) && l.orderedQty > 0)

        if (!lines.length) throw new BadRequestException('LINES_INVALID')

        const computedTotalQty = dto.totalQty ?? lines.reduce((sum, l) => sum + l.orderedQty, 0)

        const computedTotalAmount =
            dto.totalAmount ??
            lines.reduce((sum, l) => {
                const qty = l.orderedQty || 0
                const unitPrice = l.unitPrice ?? 0
                const unitDiscount = l.discountAmount ?? 0
                const taxRate = l.taxRate ?? 0

                const lineNet = qty * (unitPrice - unitDiscount)
                const lineTotal = lineNet * (1 + taxRate / 100)

                return sum + lineTotal
            }, 0)

        if (dto.paymentMode === 'POSTPAID') {
            const totalPlanned = paymentPlans.reduce((sum, p) => sum + p.amount, 0)
            const diff = Math.abs(totalPlanned - computedTotalAmount)

            if (diff > 0.01) {
                throw new BadRequestException({
                    code: 'PAYMENT_PLAN_TOTAL_MISMATCH',
                    message: 'Tổng kế hoạch thanh toán phải bằng tổng giá trị đơn hàng.',
                    totalPlanned,
                    totalAmount: computedTotalAmount,
                })
            }
        }

        const headerLocId = dto.supplierLocationId ?? null

        for (const l of lines) {
            const resolvedLocId = l.supplierLocationId ?? headerLocId
            if (!resolvedLocId) {
                throw new BadRequestException({
                    code: 'SUPPLIER_LOCATION_REQUIRED',
                    message: 'Mỗi dòng hàng phải chọn kho nhận (hoặc chọn kho mặc định ở đầu Hàng hoá).',
                })
            }
        }

        const allLocIds = Array.from(new Set([headerLocId, ...lines.map((x) => x.supplierLocationId)].filter(Boolean) as string[]))
        await this.assertLocationsBelongToSupplier({
            supplierCustomerId: dto.supplierCustomerId,
            locationIds: allLocIds,
        })

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: dto.supplierCustomerId,
            onDate: orderDate,
        })

        // 8) create PO
        const po = await this.prisma.purchaseOrder.create({
            data: {
                orderNo,
                supplierCustomerId: dto.supplierCustomerId,
                supplierLocationId: headerLocId,
                paymentTermType,
                paymentTermDays,
                allowPartialPayment,
                orderType: dto.orderType,
                paymentMode: dto.paymentMode,
                orderDate,
                expectedDate,
                note: dto.note?.trim() || null,
                status: PurchaseOrderStatus.DRAFT,
                totalQty: computedTotalQty,
                totalAmount: computedTotalAmount,
                paymentPlans: {
                    create: paymentPlans.map((p) => ({
                        dueDate: p.dueDate,
                        amount: new Prisma.Decimal(p.amount),
                        note: p.note,
                        sortOrder: p.sortOrder,
                    })),
                },
                lines: {
                    create: lines.map((l) => ({
                        productId: l.productId,
                        supplierLocationId: (l.supplierLocationId ?? headerLocId)!,
                        orderedQty: new Prisma.Decimal(l.orderedQty),
                        unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                        taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),
                        discountAmount: new Prisma.Decimal(l.discountAmount ?? 0),
                        withdrawnQty: new Prisma.Decimal(0),
                    })),
                },
            },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                paymentPlans: {
                    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                },
                lines: {
                    include: {
                        supplierLocation: { select: { id: true, code: true, name: true } },
                        product: { select: { id: true, name: true, code: true } },
                    },
                },
            },
        })

        return { po, warnings: { contract: warning } }
    }

    async approve(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { lines: true },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        if (po.status !== PurchaseOrderStatus.DRAFT) throw new BadRequestException('PO_NOT_DRAFT')

        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: po.supplierCustomerId,
            onDate: po.orderDate,
        })

        const approved = await this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.APPROVED },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        supplierLocation: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })

        return { po: approved, warnings: { contract: warning } }
    }

    async cancel(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                receipts: {
                    select: { id: true, status: true },
                },
                supplierInvoices: {
                    where: {
                        status: { in: [SupplierInvoiceStatus.DRAFT, SupplierInvoiceStatus.POSTED] },
                    },
                    select: {
                        id: true,
                        status: true,
                    },
                },
            },
        })

        if (!po) {
            throw new NotFoundException('PO_NOT_FOUND')
        }

        if (po.status === PurchaseOrderStatus.CANCELLED) {
            throw new BadRequestException('PO_ALREADY_CANCELLED')
        }

        if (po.status === PurchaseOrderStatus.COMPLETED) {
            throw new BadRequestException('PO_ALREADY_COMPLETED')
        }

        const hasConfirmedReceipt = (po.receipts ?? []).some((r) => r.status === 'CONFIRMED')
        if (hasConfirmedReceipt) {
            throw new BadRequestException('PO_HAS_CONFIRMED_RECEIPTS')
        }

        const hasInvoices = (po.supplierInvoices ?? []).length > 0
        if (hasInvoices) {
            throw new BadRequestException('PO_HAS_SUPPLIER_INVOICES')
        }

        return this.prisma.purchaseOrder.update({
            where: { id },
            data: { status: PurchaseOrderStatus.CANCELLED },
        })
    }

    async approveMany(ids: string[]) {
        const successIds: string[] = []
        const failed: Array<{ id: string; code: string; message: string }> = []

        for (const id of ids) {
            try {
                const po = await this.prisma.purchaseOrder.findUnique({
                    where: { id },
                    select: {
                        id: true,
                        status: true,
                        supplierCustomerId: true,
                        orderDate: true,
                    },
                })

                if (!po) {
                    failed.push({
                        id,
                        code: 'PO_NOT_FOUND',
                        message: 'Không tìm thấy đơn mua',
                    })
                    continue
                }

                if (po.status !== PurchaseOrderStatus.DRAFT) {
                    failed.push({
                        id,
                        code: 'PO_NOT_DRAFT',
                        message: 'Chỉ duyệt được đơn ở trạng thái nháp',
                    })
                    continue
                }

                await this.contractCheck.checkPurchaseContractWarning({
                    supplierCustomerId: po.supplierCustomerId,
                    onDate: po.orderDate,
                })

                await this.prisma.purchaseOrder.update({
                    where: { id },
                    data: { status: PurchaseOrderStatus.APPROVED },
                })

                successIds.push(id)
            } catch (e: any) {
                failed.push({
                    id,
                    code: e?.response?.code || e?.message || 'APPROVE_FAILED',
                    message: e?.response?.message || 'Không thể duyệt đơn',
                })
            }
        }

        return {
            successIds,
            failed,
        }
    }

    async cancelMany(ids: string[]) {
        const successIds: string[] = []
        const failed: Array<{ id: string; code: string; message: string }> = []

        for (const id of ids) {
            try {
                const po = await this.prisma.purchaseOrder.findUnique({
                    where: { id },
                    include: {
                        receipts: {
                            select: { id: true, status: true },
                        },
                        supplierInvoices: {
                            where: {
                                status: {
                                    in: [SupplierInvoiceStatus.DRAFT, SupplierInvoiceStatus.POSTED],
                                },
                            },
                            select: {
                                id: true,
                                status: true,
                            },
                        },
                    },
                })

                if (!po) {
                    failed.push({
                        id,
                        code: 'PO_NOT_FOUND',
                        message: 'Không tìm thấy đơn mua',
                    })
                    continue
                }

                if (po.status === PurchaseOrderStatus.CANCELLED) {
                    failed.push({
                        id,
                        code: 'PO_ALREADY_CANCELLED',
                        message: 'Đơn đã bị hủy',
                    })
                    continue
                }

                if (po.status === PurchaseOrderStatus.COMPLETED) {
                    failed.push({
                        id,
                        code: 'PO_ALREADY_COMPLETED',
                        message: 'Đơn đã hoàn thành',
                    })
                    continue
                }

                const hasConfirmedReceipt = (po.receipts ?? []).some((r) => r.status === 'CONFIRMED')
                if (hasConfirmedReceipt) {
                    failed.push({
                        id,
                        code: 'PO_HAS_CONFIRMED_RECEIPTS',
                        message: 'Đơn đã có phiếu nhận hàng xác nhận',
                    })
                    continue
                }

                const hasInvoices = (po.supplierInvoices ?? []).length > 0
                if (hasInvoices) {
                    failed.push({
                        id,
                        code: 'PO_HAS_SUPPLIER_INVOICES',
                        message: 'Đơn đã có hóa đơn nhà cung cấp',
                    })
                    continue
                }

                await this.prisma.purchaseOrder.update({
                    where: { id },
                    data: { status: PurchaseOrderStatus.CANCELLED },
                })

                successIds.push(id)
            } catch (e: any) {
                failed.push({
                    id,
                    code: e?.response?.code || e?.message || 'CANCEL_FAILED',
                    message: e?.response?.message || 'Không thể hủy đơn',
                })
            }
        }

        return {
            successIds,
            failed,
        }
    }

    async detail(id: string) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                supplier: { select: { id: true, name: true, code: true } },
                supplierLocation: { select: { id: true, code: true, name: true } },
                receipts: true,
                supplierInvoices: {
                    where: {
                        status: { not: SupplierInvoiceStatus.VOID },
                    },
                    orderBy: { createdAt: 'desc' },
                    select: {
                        id: true,
                        invoiceNo: true,
                        status: true,
                        createdAt: true,
                        sourceFileName: true,
                        sourceFileUrl: true,
                        sourceFileChecksum: true,
                        totalAmount: true,
                        payableSettlementId: true,
                        payableSettlement: {
                            select: {
                                id: true,
                                status: true,
                                amountTotal: true,
                                amountSettled: true,
                                dueDate: true,
                            },
                        },
                    },
                },
                paymentPlans: {
                    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                },
                lines: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        supplierLocation: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })

        if (!po) throw new NotFoundException('PO_NOT_FOUND')

        const orderedQtyTotal = (po.lines ?? []).reduce((sum, l) => sum + Number(l.orderedQty ?? 0), 0)
        const confirmedReceipts = (po.receipts ?? []).filter((x) => x.status === 'CONFIRMED')
        const receivedQtyTotal = confirmedReceipts.reduce((sum, r) => sum + Number(r.qty ?? 0), 0)
        const remainingQty = Math.max(orderedQtyTotal - receivedQtyTotal, 0)
        const confirmedReceiptCount = (po.receipts ?? []).filter((x) => x.status === 'CONFIRMED').length
        const invoices = po.supplierInvoices ?? []

        const settlements = invoices.map((x) => x.payableSettlement).filter(Boolean)

        const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s!.amountTotal ?? 0), 0)
        const totalSettledAmount = settlements.reduce((sum, s) => sum + Number(s!.amountSettled ?? 0), 0)

        let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID'
        if (totalSettledAmount > 0 && totalSettledAmount + 0.01 >= totalSettlementAmount && totalSettlementAmount > 0) {
            paymentStatus = 'PAID'
        } else if (totalSettledAmount > 0) {
            paymentStatus = 'PARTIALLY_PAID'
        }

        const hasInvoice = invoices.length > 0

        const canReceive =
            po.status !== PurchaseOrderStatus.CANCELLED &&
            po.status !== PurchaseOrderStatus.COMPLETED &&
            !hasInvoice &&
            (po.orderType === 'LOT' ? remainingQty > 0 : confirmedReceiptCount === 0 && remainingQty > 0)

        const summary = {
            hasReceipt: confirmedReceiptCount > 0,
            hasInvoice,
            paymentStatus,
            canCancel: !hasInvoice && confirmedReceiptCount === 0 && po.status !== PurchaseOrderStatus.CANCELLED && po.status !== PurchaseOrderStatus.COMPLETED,
            cancelBlockedReason: hasInvoice
                ? 'Đơn đã có hóa đơn nhà cung cấp'
                : confirmedReceiptCount > 0
                  ? 'Đơn đã có phiếu nhận hàng'
                  : po.status === PurchaseOrderStatus.CANCELLED
                    ? 'Đơn đã bị hủy'
                    : po.status === PurchaseOrderStatus.COMPLETED
                      ? 'Đơn đã hoàn thành'
                      : null,

            orderedQtyTotal,
            receivedQtyTotal,
            remainingQty,
            canReceive,
            receiveBlockedReason: hasInvoice
                ? 'Đơn đã có hóa đơn nhà cung cấp'
                : po.status === PurchaseOrderStatus.CANCELLED
                  ? 'Đơn đã bị hủy'
                  : po.status === PurchaseOrderStatus.COMPLETED
                    ? 'Đơn đã hoàn thành'
                    : po.orderType === 'SINGLE' && confirmedReceiptCount > 0
                      ? 'Đơn lẻ đã nhận hàng xong'
                      : remainingQty <= 0
                        ? 'Đơn đã nhận đủ số lượng'
                        : null,

            totalSettlementAmount,
            totalSettledAmount,
        }

        return {
            ...po,
            summary,
        }
    }

    async list(q: {
        keyword?: string
        supplierCustomerId?: string
        orderType?: any
        status?: PurchaseOrderStatus
        paymentMode?: any
        businessState?: 'PENDING_APPROVAL' | 'PENDING_RECEIPT' | 'PENDING_INVOICE' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED'
        dateFrom?: string
        dateTo?: string
        page?: number
        limit?: number
    }) {
        const page = Math.max(1, q.page ?? 1)
        const limit = Math.min(200, Math.max(1, q.limit ?? 20))
        const skip = (page - 1) * limit

        const where: Prisma.PurchaseOrderWhereInput = {
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            orderType: q.orderType ?? undefined,
            paymentMode: q.paymentMode ?? undefined,
            status: q.businessState ? undefined : (q.status ?? undefined),
            ...(q.dateFrom || q.dateTo
                ? {
                      orderDate: {
                          gte: q.dateFrom ? this.normalizeDateOnly(q.dateFrom) : undefined,
                          lte: q.dateTo ? this.normalizeDateOnly(q.dateTo) : undefined,
                      },
                  }
                : {}),
            ...(q.keyword
                ? {
                      OR: [{ orderNo: { contains: q.keyword.trim(), mode: 'insensitive' } }, { supplier: { name: { contains: q.keyword.trim(), mode: 'insensitive' } } }],
                  }
                : {}),
        }

        const [items] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                orderBy: { orderDate: 'desc' },
                skip,
                take: limit,
                select: {
                    id: true,
                    orderNo: true,
                    supplierCustomerId: true,
                    orderType: true,
                    paymentMode: true,
                    status: true,
                    orderDate: true,
                    expectedDate: true,
                    totalQty: true,
                    totalAmount: true,
                    createdAt: true,
                    updatedAt: true,
                    supplier: { select: { id: true, code: true, name: true } },

                    receipts: {
                        where: { status: 'CONFIRMED' },
                        select: { id: true, qty: true },
                    },

                    supplierInvoices: {
                        where: { status: { not: SupplierInvoiceStatus.VOID } },
                        select: {
                            id: true,
                            status: true,
                            totalAmount: true,
                            payableSettlementId: true,
                            payableSettlement: {
                                select: {
                                    id: true,
                                    status: true,
                                    amountTotal: true,
                                    amountSettled: true,
                                },
                            },
                        },
                    },

                    lines: {
                        select: {
                            id: true,
                            orderedQty: true,
                            product: {
                                select: {
                                    id: true,
                                    code: true,
                                    name: true,
                                },
                            },
                        },
                        orderBy: { createdAt: 'asc' },
                    },
                },
            }),
        ])

        const mappedItems = items.map((item) => ({
            ...item,
            lineCount: item.lines?.length ?? 0,
            summary: this.buildPoSummary(item),
        }))

        const filteredItems = mappedItems.filter((item) => this.matchBusinessState(item, q.businessState))

        return {
            items: filteredItems,
            total: filteredItems.length,
            page,
            limit,
        }
    }

    async getTabCounts(q: { keyword?: string; supplierCustomerId?: string; orderType?: any; paymentMode?: any; dateFrom?: string; dateTo?: string }) {
        const where: Prisma.PurchaseOrderWhereInput = {
            supplierCustomerId: q.supplierCustomerId ?? undefined,
            orderType: q.orderType ?? undefined,
            paymentMode: q.paymentMode ?? undefined,
            ...(q.dateFrom || q.dateTo
                ? {
                      orderDate: {
                          gte: q.dateFrom ? this.normalizeDateOnly(q.dateFrom) : undefined,
                          lte: q.dateTo ? this.normalizeDateOnly(q.dateTo) : undefined,
                      },
                  }
                : {}),
            ...(q.keyword
                ? {
                      OR: [{ orderNo: { contains: q.keyword.trim(), mode: 'insensitive' } }, { supplier: { name: { contains: q.keyword.trim(), mode: 'insensitive' } } }],
                  }
                : {}),
        }

        const items = await this.prisma.purchaseOrder.findMany({
            where,
            select: {
                id: true,
                status: true,
                receipts: {
                    where: { status: 'CONFIRMED' },
                    select: { id: true },
                },
                supplierInvoices: {
                    where: { status: { not: SupplierInvoiceStatus.VOID } },
                    select: {
                        id: true,
                        status: true,
                        payableSettlement: {
                            select: {
                                id: true,
                                status: true,
                                amountTotal: true,
                                amountSettled: true,
                            },
                        },
                    },
                },
            },
        })

        const counters = {
            ALL: 0,
            PENDING_APPROVAL: 0,
            PENDING_RECEIPT: 0,
            PENDING_INVOICE: 0,
            PENDING_PAYMENT: 0,
            PAID: 0,
            CANCELLED: 0,
        }

        for (const item of items) {
            const summary = this.buildPoSummary(item)

            counters.ALL++

            const push = (key: keyof typeof counters) => counters[key]++

            if (item.status === PurchaseOrderStatus.DRAFT) push('PENDING_APPROVAL')

            if (
                item.status !== PurchaseOrderStatus.DRAFT &&
                item.status !== PurchaseOrderStatus.CANCELLED &&
                item.status !== PurchaseOrderStatus.COMPLETED &&
                !summary.hasReceipt &&
                !summary.hasInvoice
            ) {
                push('PENDING_RECEIPT')
            }

            if (summary.hasReceipt && !summary.hasInvoice) push('PENDING_INVOICE')

            if (summary.hasInvoice && summary.paymentStatus !== 'PAID') {
                push('PENDING_PAYMENT')
            }

            if (summary.paymentStatus === 'PAID') push('PAID')

            if (item.status === PurchaseOrderStatus.CANCELLED) push('CANCELLED')
        }

        return counters
    }

    async createPrintBatch(dto: CreatePurchaseOrderPrintBatchDto) {
        const ids = [...new Set(dto.ids)]

        if (!ids.length) {
            throw new BadRequestException('IDS_REQUIRED')
        }

        const found = await this.prisma.purchaseOrder.findMany({
            where: { id: { in: ids } },
            select: { id: true },
        })

        const foundIds = new Set(found.map((x) => x.id))
        const missingIds = ids.filter((id) => !foundIds.has(id))

        if (missingIds.length > 0) {
            throw new BadRequestException({
                code: 'PURCHASE_ORDER_NOT_FOUND',
                missingIds,
            })
        }

        const run = await this.backgroundJobsService.createRun({
            type: PURCHASE_ORDER_PRINT_JOB_TYPE,
            name: PURCHASE_ORDER_PRINT_JOB_NAME,
            payload: { ids },
        })

        await this.jobArtifactsService.upsertArtifact({
            runId: run.id,
            kind: ARTIFACT_PO_PRINT_INPUT,
            content: { ids },
        })

        await this.backgroundJobsService.enqueueRun({
            type: PURCHASE_ORDER_PRINT_JOB_TYPE,
            queueName: QB_PURCHASE_ORDER_PRINT,
            runId: run.id,
            payloadRef: { inputKind: ARTIFACT_PO_PRINT_INPUT },
            profile: 'default',
        })

        return {
            runId: run.id,
            status: BackgroundJobStatus.PENDING,
        }
    }

    async getPrintStatus(runId: string) {
        const run = await this.prisma.backgroundJobRun.findUnique({
            where: { id: runId },
            include: { job: true },
        })

        if (!run) {
            throw new NotFoundException('BACKGROUND_JOB_RUN_NOT_FOUND')
        }

        const output = await this.jobArtifactsService.getArtifact(runId, ARTIFACT_PO_PRINT_OUTPUT)

        const content = (output?.content ?? null) as Record<string, any> | null

        return {
            runId: run.id,
            status: run.status,
            error: run.error,
            metrics: run.metrics,
            fileUrl: output?.fileUrl ?? null,
            fileName: content?.fileName ?? null,
        }
    }

    async buildPrintData(poId: string): Promise<PurchaseOrderPrintData> {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id: poId },
            include: {
                supplier: {
                    select: {
                        id: true,
                        name: true,
                        contactPhone: true,
                        shippingAddress: true,
                        defaultPurchaseContractNo: true,
                        defaultDeliveryLocation: true,
                    },
                },
                supplierLocation: {
                    select: {
                        name: true,
                        address: true,
                    },
                },
                lines: {
                    orderBy: { id: 'asc' },
                    include: {
                        product: {
                            select: { name: true },
                        },
                    },
                },
                paymentPlans: {
                    orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                },
            },
        })

        if (!po) {
            throw new NotFoundException('PURCHASE_ORDER_NOT_FOUND')
        }

        const historicalAddress = await this.resolveCustomerAddressAtDate(po.supplierCustomerId, po.orderDate)

        const contractNo = this.normalizeText(po.contractNo) ?? this.normalizeText(po.supplier.defaultPurchaseContractNo) ?? ''

        const deliveryLocation =
            this.normalizeText(po.deliveryLocation) ??
            this.normalizeText(historicalAddress) ??
            this.normalizeText(po.supplierLocation?.address) ??
            this.normalizeText(po.supplier.shippingAddress) ??
            this.normalizeText(po.supplier.defaultDeliveryLocation) ??
            ''

        const lines = po.lines.map((line, index) => {
            const qty = Number(line.orderedQty ?? 0)
            const unitPrice = Number(line.unitPrice ?? 0)
            const discountAmount = Number(line.discountAmount ?? 0)

            const rawAmount = qty * unitPrice
            const lineTotal = rawAmount - discountAmount
            const payableUnitPrice = qty > 0 ? lineTotal / qty : unitPrice

            return {
                index: index + 1,
                productName: line.product?.name || '',
                qty,
                unitPrice,
                discountAmount,
                payableUnitPrice,
                lineTotal,
            }
        })

        const totalQty = po.totalQty != null ? Number(po.totalQty) : lines.reduce((sum, l) => sum + l.qty, 0)

        const totalAmount = po.totalAmount != null ? Number(po.totalAmount) : lines.reduce((sum, l) => sum + l.lineTotal, 0)

        return {
            id: po.id,
            orderNo: po.orderNo,
            orderDate: po.orderDate,
            supplierName: po.supplier.name,
            contractNo,
            deliveryLocation,
            companyAddress: '...',
            companyPhone: po.supplier.contactPhone || '',
            deliveryTimeText: po.expectedDate ? this.formatDate(po.expectedDate) : '',
            paymentModeText: this.mapPaymentModeText(po.paymentMode),
            paymentDeadlineText: this.resolvePaymentDeadlineText(po),
            totalQty,
            totalAmount,
            lines,
        }
    }

    async handleWorkerJob(runId: string) {
        await this.backgroundJobsService.markProcessing(runId)

        const publicDir = path.join(process.cwd(), 'public', 'po')
        let browser: puppeteer.Browser | null = null

        try {
            await fs.mkdir(publicDir, { recursive: true })

            const inputArtifact = await this.jobArtifactsService.getArtifact(runId, ARTIFACT_PO_PRINT_INPUT)

            const input = (inputArtifact?.content ?? null) as PurchaseOrderPrintBatchInput | null
            const ids = Array.isArray(input?.ids) ? [...new Set(input.ids)] : []

            if (!ids.length) {
                throw new Error('PRINT_BATCH_INPUT_NOT_FOUND')
            }

            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            })

            const mergedPdf = await PDFDocument.create()

            let processed = 0
            let success = 0
            let failed = 0

            await this.backgroundJobsService.updateMetrics(runId, {
                total: ids.length,
                processed,
                success,
                failed,
                currentOrderNo: null,
            })

            for (const id of ids) {
                try {
                    const data = await this.buildPrintData(id)

                    await this.backgroundJobsService.updateMetrics(runId, {
                        total: ids.length,
                        processed,
                        success,
                        failed,
                        currentOrderNo: data.orderNo,
                    })

                    const html = renderPurchaseOrderPrintHtml(data)
                    const page = await browser.newPage()

                    try {
                        await page.setContent(html, { waitUntil: 'networkidle0' })

                        const pdfBuffer = await page.pdf({
                            format: 'A4',
                            printBackground: true,
                            margin: {
                                top: '12mm',
                                right: '10mm',
                                bottom: '12mm',
                                left: '10mm',
                            },
                        })

                        const partPdf = await PDFDocument.load(pdfBuffer)
                        const pages = await mergedPdf.copyPages(partPdf, partPdf.getPageIndices())

                        for (const p of pages) {
                            mergedPdf.addPage(p)
                        }

                        success++
                    } finally {
                        await page.close()
                    }
                } catch (error) {
                    failed++
                    throw error
                } finally {
                    processed++

                    await this.backgroundJobsService.updateMetrics(runId, {
                        total: ids.length,
                        processed,
                        success,
                        failed,
                        currentOrderNo: null,
                    })
                }
            }

            if (success === 0) {
                await this.backgroundJobsService.markFailed(runId, 'ALL_PRINT_FAILED')
                return
            }

            const mergedBytes = await mergedPdf.save()
            const fileName = `${runId}.pdf`
            const finalPath = path.join(publicDir, fileName)

            await fs.writeFile(finalPath, mergedBytes)

            const checksum = createHash('sha256').update(Buffer.from(mergedBytes)).digest('hex')

            const fileUrl = `/static/po/${fileName}`

            await this.jobArtifactsService.upsertArtifact({
                runId,
                kind: ARTIFACT_PO_PRINT_OUTPUT,
                fileUrl,
                checksum,
                content: {
                    fileName,
                    totalCount: ids.length,
                    successCount: success,
                    failedCount: failed,
                },
            })

            await this.backgroundJobsService.markSuccess(runId, {
                total: ids.length,
                processed,
                success,
                failed,
            })
        } catch (error) {
            await this.backgroundJobsService.markFailed(runId, error)
            throw error
        } finally {
            if (browser) {
                await browser.close()
            }
        }
    }
}
