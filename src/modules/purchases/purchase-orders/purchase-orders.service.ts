// src/modules/purchases/purchase-orders/purchase-orders.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BackgroundJobStatus,
    ManagerRole,
    MasterStatus,
    Prisma,
    PurchaseOrderStatus,
    SupplierInvoiceStatus,
    WarehousePartyRole,
} from '@prisma/client'
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
import { PDFDocument } from 'pdf-lib'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as puppeteer from 'puppeteer-core'
import { renderPurchaseOrderPrintHtml } from './templates/purchase-order-print.template'
import { Browser } from 'puppeteer-core'
import { PaymentRequestPrintData, renderPaymentRequestPrintHtml } from './templates/payment-request-print.template'
import { NotificationOutboxService } from 'src/modules/notifications/notification-outbox.service'
import { PURCHASE_NOTIFICATION_EVENTS } from 'src/modules/notifications/notification-events'

@Injectable()
export class PurchaseOrdersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly contractCheck: ContractCheckService,
        private readonly backgroundJobsService: BackgroundJobsService,
        private readonly jobArtifactsService: JobArtifactsService,
        private readonly notificationOutbox: NotificationOutboxService,
    ) {}

    private async renderMergedPdfFromHtmls(htmls: string[]): Promise<Buffer> {
        let browser: Browser | null = null

        try {
            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            })

            const mergedPdf = await PDFDocument.create()

            for (const html of htmls) {
                const page = await browser.newPage()

                try {
                    await page.setContent(html, { waitUntil: 'networkidle0' })

                    const pdfBuffer = await page.pdf({
                        format: 'A4',
                        printBackground: true,
                        margin: {
                            top: '10mm',
                            right: '10mm',
                            bottom: '10mm',
                            left: '10mm',
                        },
                    })

                    const partPdf = await PDFDocument.load(pdfBuffer)
                    const pages = await mergedPdf.copyPages(partPdf, partPdf.getPageIndices())

                    for (const p of pages) {
                        mergedPdf.addPage(p)
                    }
                } finally {
                    await page.close()
                }
            }

            const mergedBytes = await mergedPdf.save()
            return Buffer.from(mergedBytes)
        } finally {
            if (browser) {
                await browser.close()
            }
        }
    }

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

    private commercialOrderPeriod(orderDate: Date) {
        const year = String(orderDate.getUTCFullYear()).slice(-2)
        const month = String(orderDate.getUTCMonth() + 1).padStart(2, '0')
        return `${year}${month}`
    }

    private async generateCommercialOrderNo(supplierCustomerId: string, orderDate: Date) {
        const supplier = await this.prisma.party.findUnique({
            where: { id: supplierCustomerId },
            select: { id: true, code: true },
        })
        if (!supplier?.code?.trim()) throw new BadRequestException('SUPPLIER_CODE_REQUIRED')

        const sequence = await this.prisma.documentSequence.upsert({
            where: {
                moduleCode_period: {
                    moduleCode: 'PURCHASE_COMMERCIAL',
                    period: this.commercialOrderPeriod(orderDate),
                },
            },
            create: {
                moduleCode: 'PURCHASE_COMMERCIAL',
                period: this.commercialOrderPeriod(orderDate),
                currentNo: 1,
            },
            update: { currentNo: { increment: 1 } },
        })
        const supplierCode = supplier.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
        return `TM${this.commercialOrderPeriod(orderDate)}${String(sequence.currentNo).padStart(4, '0')}${supplierCode}`
    }

    private async refreshCommercialOrderNo(
        currentOrderNo: string,
        currentSupplierCustomerId: string,
        supplierCustomerId: string,
    ) {
        const suppliers = await this.prisma.party.findMany({
            where: { id: { in: [currentSupplierCustomerId, supplierCustomerId] } },
            select: { id: true, code: true },
        })
        const normalize = (code?: string | null) => code?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
        const previousCode = normalize(suppliers.find((item) => item.id === currentSupplierCustomerId)?.code)
        const nextCode = normalize(suppliers.find((item) => item.id === supplierCustomerId)?.code)
        if (!nextCode) throw new BadRequestException('SUPPLIER_CODE_REQUIRED')
        const prefix = previousCode && currentOrderNo.toUpperCase().endsWith(previousCode)
            ? currentOrderNo.slice(0, -previousCode.length)
            : currentOrderNo.replace(/[A-Z]+$/i, '')
        return `${prefix}${nextCode}`
    }

    private async isDepartmentHead(userId?: string | null) {
        if (!userId) return false
        const now = new Date()
        const employee = await this.prisma.employee.findFirst({
            where: {
                userId,
                deletedAt: null,
                managerRoles: {
                    some: {
                        role: { in: [ManagerRole.head, ManagerRole.acting] },
                        startDate: { lte: now },
                        OR: [{ endDate: null }, { endDate: { gte: now } }],
                    },
                },
            },
            select: { id: true },
        })
        return Boolean(employee)
    }

    async validateContract(supplierCustomerId: string, orderDate: string) {
        if (!supplierCustomerId) throw new BadRequestException('SUPPLIER_REQUIRED')
        const onDate = this.toDateOrThrow(orderDate, 'ORDER_DATE_INVALID')
        return this.contractCheck.checkPurchaseContractWarning({ supplierCustomerId, onDate })
    }

    private async assertLocationsBelongToSupplier(args: { supplierCustomerId: string; locationIds: string[] }) {
        const { supplierCustomerId, locationIds } = args
        if (!locationIds.length) throw new BadRequestException('RECEIVING_WAREHOUSE_REQUIRED')

        const rows = await this.prisma.warehouse.findMany({
            where: {
                id: { in: locationIds },
                status: MasterStatus.ACTIVE,
                parties: {
                    some: { partyId: supplierCustomerId, role: WarehousePartyRole.OPERATOR, validTo: null },
                },
            },
            select: { id: true, legalEntityId: true },
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
        const legalEntityIds = [...new Set(rows.map((row) => row.legalEntityId))]
        if (legalEntityIds.length !== 1) {
            throw new BadRequestException('PURCHASE_ORDER_WAREHOUSES_MUST_BELONG_TO_ONE_LEGAL_ENTITY')
        }
        return legalEntityIds[0]
    }

    private async createExpectedSupplies(
        tx: Prisma.TransactionClient,
        args: { purchaseOrderId: string; legalEntityId: string; expectedAt: Date | null; lines: Array<{ id: string; productId: string; receivingWarehouseId: string | null; orderedQty: Prisma.Decimal | number }> },
    ) {
        const legalEntity = await tx.legalEntity.findUnique({
            where: { id: args.legalEntityId },
            select: { partyId: true },
        })
        if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_FOUND')

        await tx.expectedSupply.createMany({
            data: args.lines.map((line) => {
                if (!line.receivingWarehouseId) throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')
                return {
                    expectedNo: `EXP-PO-${args.purchaseOrderId}-${line.id}`,
                    warehouseId: line.receivingWarehouseId,
                    productId: line.productId,
                    ownerPartyId: legalEntity.partyId,
                    purchaseOrderLineId: line.id,
                    expectedActualQty: line.orderedQty,
                    expectedAt: args.expectedAt,
                }
            }),
        })
    }

    private mapPurchaseOrder<T extends Record<string, any>>(order: T) {
        const lines = (order.lines ?? []).map((line: any) => ({
            ...line,
            supplierLocationId: line.receivingWarehouseId,
            supplierLocation: line.receivingWarehouse,
        }))
        const totalQty = lines.reduce((sum: number, line: any) => sum + Number(line.orderedQty ?? 0), 0)
        const totalAmount = lines.reduce((sum: number, line: any) => {
            const qty = Number(line.orderedQty ?? 0)
            const unitPrice = Number(line.unitPrice ?? 0)
            const discount = Number(line.discountAmount ?? 0)
            const taxRate = Number(line.taxRate ?? 0)
            return sum + (qty * unitPrice - discount) * (1 + taxRate / 100)
        }, 0)
        const defaultWarehouse = lines.length > 0 && lines.every((line: any) => line.receivingWarehouseId === lines[0].receivingWarehouseId)
            ? lines[0].receivingWarehouse ?? null
            : null
        return {
            ...order,
            lines,
            supplierLocationId: defaultWarehouse?.id ?? null,
            supplierLocation: defaultWarehouse,
            totalQty,
            totalAmount,
        }
    }

    private buildPoSummary(item: any) {
        const confirmedReceiptCount = item.receipts?.length ?? 0
        const hasReceipt = confirmedReceiptCount > 0

        const invoices = item.supplierInvoices ?? []
        const hasInvoice = invoices.length > 0

        const settlementMap = new Map<string, any>()
        for (const inv of invoices) {
            const st = inv.openItem
            if (st?.id) settlementMap.set(st.id, st)
        }

        const settlements = Array.from(settlementMap.values())

        const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s.originalAmount ?? 0), 0)

        const totalSettledAmount = settlements.reduce(
            (sum, s) => sum + Number(new Prisma.Decimal(s.originalAmount ?? 0).minus(s.outstandingAmount ?? 0)),
            0,
        )

        const allSettled = settlements.length > 0 && settlements.every((s) => s.status === 'SETTLED')

        let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID'

        if (allSettled) {
            paymentStatus = 'PAID'
        } else if (totalSettledAmount > 0) {
            paymentStatus = 'PARTIALLY_PAID'
        }

        const orderedQtyTotal = (item.lines ?? []).reduce((sum: number, l: any) => sum + Number(l.orderedQty ?? 0), 0)

        const receivedQtyTotal = (item.receipts ?? []).reduce(
            (sum: number, receipt: any) =>
                sum +
                (receipt.lines ?? []).reduce(
                    (lineSum: number, line: any) => lineSum + Number(line.actualQty ?? 0),
                    0,
                ),
            0,
        )

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

    private numberToVietnameseMoney(input: number): string {
        const n = Math.round(Number(input || 0))
        if (!Number.isFinite(n) || n <= 0) return 'Không đồng'

        const units = ['', 'nghìn', 'triệu', 'tỷ', 'nghìn tỷ', 'triệu tỷ']
        const digits = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín']

        const readTriple = (num: number, full: boolean): string => {
            const hundred = Math.floor(num / 100)
            const tenUnit = num % 100
            const ten = Math.floor(tenUnit / 10)
            const unit = tenUnit % 10
            const parts: string[] = []

            if (full || hundred > 0) {
                parts.push(`${digits[hundred]} trăm`)
            }

            if (ten > 1) {
                parts.push(`${digits[ten]} mươi`)
                if (unit === 1) parts.push('mốt')
                else if (unit === 4) parts.push('bốn')
                else if (unit === 5) parts.push('lăm')
                else if (unit > 0) parts.push(digits[unit])
            } else if (ten === 1) {
                parts.push('mười')
                if (unit === 5) parts.push('lăm')
                else if (unit > 0) parts.push(digits[unit])
            } else if (ten === 0 && unit > 0) {
                if (full || hundred > 0) parts.push('lẻ')
                if (unit === 5 && (full || hundred > 0)) parts.push('năm')
                else parts.push(digits[unit])
            }

            return parts.join(' ').trim()
        }

        const chunks: number[] = []
        let temp = n
        while (temp > 0) {
            chunks.push(temp % 1000)
            temp = Math.floor(temp / 1000)
        }

        const parts: string[] = []
        for (let i = chunks.length - 1; i >= 0; i--) {
            const chunk = chunks[i]
            if (chunk === 0) continue

            const full = i < chunks.length - 1
            const text = readTriple(chunk, full)
            const unit = units[i] ? ` ${units[i]}` : ''
            parts.push(`${text}${unit}`.trim())
        }

        const sentence = parts.join(' ').replace(/\s+/g, ' ').trim()
        return sentence.charAt(0).toUpperCase() + sentence.slice(1) + ' đồng'
    }

    async create(dto: {
        orderNo?: string
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
    }, actorId?: string | null) {
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
        const legalEntityId = await this.assertLocationsBelongToSupplier({
            supplierCustomerId: dto.supplierCustomerId,
            locationIds: allLocIds,
        })

        const contract = await this.contractCheck.requireActivePurchaseContract({
            supplierCustomerId: dto.supplierCustomerId,
            onDate: orderDate,
        })
        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: dto.supplierCustomerId,
            onDate: orderDate,
        })
        const autoApproved = await this.isDepartmentHead(actorId)
        const now = new Date()
        const orderNo = await this.generateCommercialOrderNo(dto.supplierCustomerId, orderDate)

        // 8) create PO
        const po = await this.prisma.$transaction(async (tx) => {
            const created = await tx.purchaseOrder.create({
                data: {
                orderNo,
                legalEntityId,
                supplierCustomerId: dto.supplierCustomerId,
                contractId: contract.id,
                contractNo: contract.code,
                paymentTermType,
                paymentTermDays,
                allowPartialPayment,
                orderType: dto.orderType,
                paymentMode: dto.paymentMode,
                orderDate,
                expectedDate,
                note: dto.note?.trim() || null,
                status: autoApproved ? PurchaseOrderStatus.APPROVED : PurchaseOrderStatus.DRAFT,
                createdById: actorId ?? null,
                approvedById: autoApproved ? actorId ?? null : null,
                approvedAt: autoApproved ? now : null,
                paymentPlans: {
                    create: paymentPlans.map((p) => ({
                        dueDate: p.dueDate,
                        amount: new Prisma.Decimal(p.amount),
                        note: p.note,
                        sortOrder: p.sortOrder,
                    })),
                },
                lines: {
                    create: lines.map((l, index) => ({
                        lineNo: index + 1,
                        productId: l.productId,
                        receivingWarehouseId: (l.supplierLocationId ?? headerLocId)!,
                        orderedQty: new Prisma.Decimal(l.orderedQty),
                        unitPrice: l.unitPrice == null ? null : new Prisma.Decimal(l.unitPrice),
                        taxRate: l.taxRate == null ? null : new Prisma.Decimal(l.taxRate),
                        discountAmount: new Prisma.Decimal(l.discountAmount ?? 0),
                    })),
                },
            },
                include: {
                    supplier: { select: { id: true, name: true, code: true } },
                    paymentPlans: {
                        orderBy: [{ sortOrder: 'asc' }, { dueDate: 'asc' }],
                    },
                    lines: {
                        include: {
                            receivingWarehouse: { select: { id: true, code: true, name: true } },
                            product: { select: { id: true, name: true, code: true } },
                        },
                    },
                },
            })
            await this.createExpectedSupplies(tx, {
                purchaseOrderId: created.id,
                legalEntityId,
                expectedAt: expectedDate ?? orderDate,
                lines: created.lines,
            })
            if (dto.orderType === 'LOT' && !autoApproved) {
                await this.notificationOutbox.emit(
                    {
                        eventType: PURCHASE_NOTIFICATION_EVENTS.ORDER_PENDING_APPROVAL,
                        aggregateType: 'COMMERCIAL_PURCHASE',
                        aggregateId: created.id,
                        dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.ORDER_PENDING_APPROVAL}:${created.id}`,
                        payload: {
                            entityType: 'COMMERCIAL_PURCHASE',
                            entityId: created.id,
                            orderNo: created.orderNo,
                            actionRequired: true,
                            recipientPermissionCodes: ['purchases.approve'],
                            excludeUserIds: actorId ? [actorId] : [],
                        },
                    },
                    tx,
                )
            }
            return created
        })

        return { po: this.mapPurchaseOrder(po), warnings: { contract: warning } }
    }

    async updateDraft(id: string, dto: any) {
        const current = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: { supplierInvoices: { select: { id: true } } } })
        if (!current) throw new NotFoundException('PURCHASE_ORDER_NOT_FOUND')
        if (current.status !== PurchaseOrderStatus.DRAFT || current.supplierInvoices.length) throw new BadRequestException('ONLY_DRAFT_PURCHASE_ORDER_CAN_BE_UPDATED')

        const orderDate = this.toDateOrThrow(dto.orderDate, 'ORDER_DATE_INVALID')
        const expectedDate = dto.expectedDate ? this.toDateOrThrow(dto.expectedDate, 'EXPECTED_DATE_INVALID') : null
        const lines = (dto.lines ?? []).map((line: any) => ({
            productId: line.productId,
            orderedQty: Number(line.orderedQty) || 0,
            supplierLocationId: line.supplierLocationId,
            unitPrice: line.unitPrice == null ? null : Number(line.unitPrice),
            discountAmount: Number(line.discountAmount ?? 0),
            taxRate: line.taxRate == null ? null : Number(line.taxRate),
        })).filter((line: any) => line.productId && line.orderedQty > 0)
        if (!lines.length || lines.some((line: any) => !line.supplierLocationId)) throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')

        const locationIds = Array.from(new Set(lines.map((line: any) => line.supplierLocationId))) as string[]
        const legalEntityId = await this.assertLocationsBelongToSupplier({ supplierCustomerId: dto.supplierCustomerId, locationIds })
        const contract = await this.contractCheck.requireActivePurchaseContract({ supplierCustomerId: dto.supplierCustomerId, onDate: orderDate })
        const orderNo = current.supplierCustomerId === dto.supplierCustomerId
            ? current.orderNo
            : await this.refreshCommercialOrderNo(current.orderNo, current.supplierCustomerId, dto.supplierCustomerId)
        const plans = dto.paymentMode === 'POSTPAID' ? (dto.paymentPlans ?? []).map((plan: any, index: number) => ({ dueDate: this.toDateOrThrow(plan.dueDate, 'PAYMENT_PLAN_DUE_DATE_INVALID'), amount: new Prisma.Decimal(Number(plan.amount) || 0), note: plan.note?.trim() || null, sortOrder: plan.sortOrder ?? index })).filter((plan: any) => plan.amount.gt(0)) : []
        if (dto.paymentMode === 'POSTPAID' && !plans.length) throw new BadRequestException('PAYMENT_PLANS_REQUIRED')

        await this.prisma.$transaction(async (tx) => {
            await tx.expectedSupply.deleteMany({ where: { purchaseOrderLine: { purchaseOrderId: id } } })
            await tx.purchaseOrderLine.deleteMany({ where: { purchaseOrderId: id } })
            await tx.purchaseOrderPaymentPlan.deleteMany({ where: { purchaseOrderId: id } })
            const updated = await tx.purchaseOrder.update({ where: { id }, data: {
                orderNo,
                supplierCustomerId: dto.supplierCustomerId, legalEntityId, contractId: contract.id, contractNo: contract.code,
                paymentMode: dto.paymentMode, paymentTermType: dto.paymentTermType ?? PaymentTermType.SAME_DAY,
                paymentTermDays: dto.paymentMode === 'POSTPAID' ? Number(dto.paymentTermDays) || null : null,
                orderDate, expectedDate, note: dto.note?.trim() || null,
                paymentPlans: { create: plans },
                lines: { create: lines.map((line: any, index: number) => ({ lineNo: index + 1, productId: line.productId, receivingWarehouseId: line.supplierLocationId, orderedQty: new Prisma.Decimal(line.orderedQty), unitPrice: line.unitPrice == null ? null : new Prisma.Decimal(line.unitPrice), discountAmount: new Prisma.Decimal(line.discountAmount), taxRate: line.taxRate == null ? null : new Prisma.Decimal(line.taxRate) })) },
            }, include: { lines: true } })
            await this.createExpectedSupplies(tx, {
                purchaseOrderId: id,
                legalEntityId,
                expectedAt: expectedDate ?? orderDate,
                lines: updated.lines,
            })
        })
        return this.detail(id)
    }

    async updateActualReceived(id: string, rows: Array<{ purchaseOrderLineId: string; actualReceivedQty: number }>) {
        if (!rows.length) throw new BadRequestException('ACTUAL_RECEIVED_LINES_REQUIRED')

        const order = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: {
                supplierInvoices: { select: { id: true } },
                lines: { select: { id: true, productId: true, receivingWarehouseId: true } },
            },
        })
        if (!order) throw new NotFoundException('PURCHASE_ORDER_NOT_FOUND')
        if (order.supplierInvoices.length) throw new BadRequestException('ACTUAL_RECEIVED_LOCKED_AFTER_INVOICE')
        if (new Set(rows.map((row) => row.purchaseOrderLineId)).size !== rows.length) {
            throw new BadRequestException('ACTUAL_RECEIVED_LINE_DUPLICATED')
        }

        const validLineIds = new Set(order.lines.map((line) => line.id))
        for (const row of rows) {
            if (!validLineIds.has(row.purchaseOrderLineId) || !Number.isFinite(Number(row.actualReceivedQty)) || Number(row.actualReceivedQty) < 0) {
                throw new BadRequestException('ACTUAL_RECEIVED_LINE_INVALID')
            }
        }

        await this.prisma.$transaction(async (tx) => {
            const legalEntity = await tx.legalEntity.findUnique({
                where: { id: order.legalEntityId },
                select: { partyId: true },
            })
            if (!legalEntity) throw new BadRequestException('LEGAL_ENTITY_NOT_FOUND')

            const linesById = new Map(order.lines.map((line) => [line.id, line]))
            for (const row of rows) {
                const qty = new Prisma.Decimal(row.actualReceivedQty)
                const line = linesById.get(row.purchaseOrderLineId)!
                await tx.purchaseOrderLine.update({
                    where: { id: row.purchaseOrderLineId },
                    data: { actualReceivedQty: qty },
                })
                const expected = await tx.expectedSupply.updateMany({
                    where: { purchaseOrderLineId: row.purchaseOrderLineId },
                    data: { expectedActualQty: qty, version: { increment: 1 } },
                })
                if (expected.count === 0) {
                    if (!line.receivingWarehouseId) throw new BadRequestException('SUPPLIER_LOCATION_REQUIRED')
                    await tx.expectedSupply.create({
                        data: {
                            expectedNo: `EXP-PO-${order.id}-${line.id}`,
                            warehouseId: line.receivingWarehouseId,
                            productId: line.productId,
                            ownerPartyId: legalEntity.partyId,
                            purchaseOrderLineId: line.id,
                            expectedActualQty: qty,
                            expectedAt: order.expectedDate ?? order.orderDate,
                        },
                    })
                }
            }
        })
        return this.detail(id)
    }

    async approve(id: string, actorId?: string | null) {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id },
            include: { lines: true },
        })
        if (!po) throw new NotFoundException('PO_NOT_FOUND')
        if (po.status !== PurchaseOrderStatus.DRAFT) throw new BadRequestException('PO_NOT_DRAFT')

        const contract = await this.contractCheck.requireActivePurchaseContract({
            supplierCustomerId: po.supplierCustomerId,
            onDate: po.orderDate,
        })
        const warning = await this.contractCheck.checkPurchaseContractWarning({
            supplierCustomerId: po.supplierCustomerId,
            onDate: po.orderDate,
        })

        const approved = await this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchaseOrder.update({
                where: { id },
                data: {
                    status: PurchaseOrderStatus.APPROVED,
                    contractId: contract.id,
                    contractNo: contract.code,
                    approvedById: actorId ?? null,
                    approvedAt: new Date(),
                },
                include: {
                    supplier: { select: { id: true, name: true, code: true } },
                    lines: {
                        include: {
                            product: { select: { id: true, code: true, name: true, uom: true } },
                            receivingWarehouse: { select: { id: true, code: true, name: true } },
                        },
                    },
                },
            })
            if (updated.orderType === 'LOT') {
                await this.notificationOutbox.emit(
                    {
                        eventType: PURCHASE_NOTIFICATION_EVENTS.ORDER_APPROVED,
                        aggregateType: 'COMMERCIAL_PURCHASE',
                        aggregateId: updated.id,
                        dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.ORDER_APPROVED}:${updated.id}:${updated.approvedAt?.toISOString()}`,
                        payload: {
                            entityType: 'COMMERCIAL_PURCHASE',
                            entityId: updated.id,
                            orderNo: updated.orderNo,
                            resolvedActions: ['REVIEW_PURCHASE_ORDER'],
                            recipientUserIds: updated.createdById ? [updated.createdById] : [],
                            excludeUserIds: actorId ? [actorId] : [],
                        },
                    },
                    tx,
                )
            }
            return updated
        })

        return { po: this.mapPurchaseOrder(approved), warnings: { contract: warning } }
    }

    async cancel(id: string, actorId?: string | null) {
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

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.purchaseOrder.update({
                where: { id },
                data: { status: PurchaseOrderStatus.CANCELLED },
            })
            if (updated.orderType === 'LOT') {
                await this.notificationOutbox.emit(
                    {
                        eventType: PURCHASE_NOTIFICATION_EVENTS.ORDER_CANCELLED,
                        aggregateType: 'COMMERCIAL_PURCHASE',
                        aggregateId: updated.id,
                        dedupeKey: `${PURCHASE_NOTIFICATION_EVENTS.ORDER_CANCELLED}:${updated.id}`,
                        payload: {
                            entityType: 'COMMERCIAL_PURCHASE',
                            entityId: updated.id,
                            orderNo: updated.orderNo,
                            resolvedActions: ['REVIEW_PURCHASE_ORDER'],
                            recipientUserIds: updated.createdById ? [updated.createdById] : [],
                            excludeUserIds: actorId ? [actorId] : [],
                        },
                    },
                    tx,
                )
            }
            return updated
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
                salesOrder: {
                    select: {
                        id: true,
                        orderNo: true,
                        orderDate: true,
                        status: true,
                        customer: { select: { id: true, code: true, name: true } },
                        lines: {
                            orderBy: { lineNo: 'asc' },
                            select: {
                                id: true,
                                productId: true,
                                orderedActualQty: true,
                                product: { select: { id: true, code: true, name: true, uom: true } },
                            },
                        },
                    },
                },
                receipts: {
                    select: {
                        id: true,
                        receiptNo: true,
                        receiptDate: true,
                        status: true,
                        warehouseId: true,
                        warehouse: {
                            select: {
                                id: true,
                                code: true,
                                name: true,
                            },
                        },
                        lines: {
                            orderBy: { lineNo: 'asc' },
                            select: {
                                purchaseOrderLineId: true,
                                actualQty: true,
                            },
                        },
                    },
                },
                supplierInvoices: {
                    where: {
                        status: { not: SupplierInvoiceStatus.VOIDED },
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
                        openItem: {
                            select: {
                                id: true,
                                status: true,
                                originalAmount: true,
                                outstandingAmount: true,
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
                        receivingWarehouse: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })

        if (!po) throw new NotFoundException('PO_NOT_FOUND')

        const orderedQtyTotal = (po.lines ?? []).reduce((sum, l) => sum + Number(l.orderedQty ?? 0), 0)
        const confirmedReceipts = (po.receipts ?? []).filter((x) => x.status === 'CONFIRMED')
        const receivedQtyTotal = confirmedReceipts.reduce(
            (sum, receipt) =>
                sum + receipt.lines.reduce((lineSum, line) => lineSum + Number(line.actualQty ?? 0), 0),
            0,
        )
        const remainingQty = Math.max(orderedQtyTotal - receivedQtyTotal, 0)
        const confirmedReceiptCount = (po.receipts ?? []).filter((x) => x.status === 'CONFIRMED').length
        const invoices = po.supplierInvoices ?? []

        const settlements = invoices.map((x) => x.openItem).filter(Boolean)

        const totalSettlementAmount = settlements.reduce((sum, s) => sum + Number(s!.originalAmount ?? 0), 0)
        const totalSettledAmount = settlements.reduce(
            (sum, s) => sum + Number(new Prisma.Decimal(s!.originalAmount ?? 0).minus(s!.outstandingAmount ?? 0)),
            0,
        )

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

        const receiptDates = confirmedReceipts
            .map((r) => r.receiptDate)
            .filter(Boolean)
            .sort()

        const firstReceiptDate = receiptDates.length ? receiptDates[0] : null
        const lastReceiptDate = receiptDates.length ? receiptDates[receiptDates.length - 1] : null

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
            firstReceiptDate,
            lastReceiptDate,
        }

        return {
            ...this.mapPurchaseOrder(po),
            receipts: po.receipts.map((receipt) => {
                const line = receipt.lines[0] ?? null
                return {
                    ...receipt,
                    purchaseOrderLineId: line?.purchaseOrderLineId ?? null,
                    qty: line?.actualQty ?? null,
                    supplierLocationId: receipt.warehouseId,
                    supplierLocation: receipt.warehouse,
                }
            }),
            supplierInvoices: po.supplierInvoices.map((invoice) => ({
                ...invoice,
                payableSettlementId: invoice.openItem?.id ?? null,
                payableSettlement: invoice.openItem
                    ? {
                          ...invoice.openItem,
                          amountTotal: invoice.openItem.originalAmount,
                          amountSettled: invoice.openItem.originalAmount.minus(invoice.openItem.outstandingAmount),
                      }
                    : null,
            })),
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
            bizType: "COMMERCIAL",
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
                    createdAt: true,
                    updatedAt: true,
                    supplier: { select: { id: true, code: true, name: true } },

                    receipts: {
                        where: { status: 'CONFIRMED' },
                        select: {
                            id: true,
                            lines: { select: { actualQty: true } },
                        },
                    },

                    supplierInvoices: {
                        where: { status: { not: SupplierInvoiceStatus.VOIDED } },
                        select: {
                            id: true,
                            status: true,
                            totalAmount: true,
                            openItem: {
                                select: {
                                    id: true,
                                    status: true,
                                    originalAmount: true,
                                    outstandingAmount: true,
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

        const mappedItems = items.map((item) => {
            const mapped = this.mapPurchaseOrder(item)
            return {
                ...mapped,
                lineCount: mapped.lines.length,
                summary: this.buildPoSummary(mapped),
            }
        })

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
                    where: { status: { not: SupplierInvoiceStatus.VOIDED } },
                    select: {
                        id: true,
                        status: true,
                        openItem: {
                            select: {
                                id: true,
                                status: true,
                                originalAmount: true,
                                outstandingAmount: true,
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
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: {
                            select: { name: true },
                        },
                        receivingWarehouse: {
                            select: { name: true, address: true },
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

        const deliveryLocation = this.normalizeText(po.supplier.defaultDeliveryLocation) ?? ''

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

        const totalQty = lines.reduce((sum, l) => sum + l.qty, 0)

        const totalAmount = lines.reduce((sum, l) => sum + l.lineTotal, 0)

        return {
            id: po.id,
            orderNo: po.orderNo,
            orderDate: this.formatDate(po.orderDate),
            supplierName: po.supplier.name,
            contractNo,
            deliveryLocation,
            companyAddress: po.lines[0]?.receivingWarehouse?.address || po.supplier.shippingAddress || historicalAddress || '',
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

    async generateSinglePrintPdf(poId: string): Promise<Buffer> {
        const data = await this.buildPrintData(poId)

        const html = renderPurchaseOrderPrintHtml(data)

        let browser: puppeteer.Browser | null = null

        try {
            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            })

            const page = await browser.newPage()

            await page.setContent(html, {
                waitUntil: 'networkidle0',
            })

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

            return Buffer.from(pdfBuffer)
        } finally {
            if (browser) {
                await browser.close()
            }
        }
    }

    // async printBatchSync(dto: CreatePurchaseOrderPrintBatchDto): Promise<Buffer> {
    //     const ids = [...new Set(dto.ids)]

    //     if (!ids.length) {
    //         throw new BadRequestException('IDS_REQUIRED')
    //     }

    //     const htmls: string[] = []

    //     for (const id of ids) {
    //         const data = await this.buildPrintData(id)
    //         htmls.push(renderPurchaseOrderPrintHtml(data))
    //     }

    //     return this.renderMergedPdfFromHtmls(htmls)
    // }

    async buildPaymentRequestPrintData(poId: string): Promise<PaymentRequestPrintData> {
        const po = await this.prisma.purchaseOrder.findUnique({
            where: { id: poId },
            include: {
                supplier: {
                    select: {
                        id: true,
                        code: true,
                        name: true,
                    },
                },
                lines: {
                    include: {
                        product: {
                            select: {
                                code: true,
                                name: true,
                            },
                        },
                    },
                    orderBy: { id: 'asc' },
                },
            },
        })

        if (!po) {
            throw new NotFoundException('PURCHASE_ORDER_NOT_FOUND')
        }

        const totalAmount = (po.lines ?? []).reduce((sum, line) => {
            const qty = Number(line.orderedQty ?? 0)
            const price = Number(line.unitPrice ?? 0)
            const discount = Number(line.discountAmount ?? 0)
            return sum + qty * price - discount
        }, 0)

        const supplierCode = po.supplier?.code || ''
        const supplierName = po.supplier?.name || ''
        const orderNo = po.orderNo

        return {
            cityText: 'Thanh Hóa',
            printDate: new Date(),

            requesterName: 'Lê Thị Hoài',
            requesterDepartment: 'Mua hàng',

            beneficiaryName: supplierName,
            beneficiaryAccountNo: '',
            beneficiaryBankName: '',

            totalAmount,
            totalAmountText: this.numberToVietnameseMoney(totalAmount),

            rows: [
                {
                    supplierCode,
                    orderNo,
                    note: po.note || '',
                    amount: totalAmount,
                    content: `Công ty Thiên Phúc thanh toán tiền hàng cho công ty ${supplierName.toUpperCase()}`,
                },
            ],

            bankDepartmentLabel: 'BỘ PHẬN NGÂN HÀNG',
            purchaseDepartmentLabel: 'BỘ PHẬN MUA HÀNG',
            deputyDirectorLabel: 'Phó Giám Đốc',
            requesterLabel: 'Người Đề Nghị',

            deputyDirectorName: 'Nguyễn Ngọc Mai',
            requesterSignName: 'Lê Thị Hoài',
        }
    }

    async printPaymentRequestByRequestId(requestId: string): Promise<Buffer> {
        const request = await this.prisma.purchaseTermPaymentRequest.findUnique({
            where: { id: requestId },
            include: {
                purchaseOrder: {
                    include: {
                        supplier: { select: { code: true, name: true } },
                    },
                },
                supplierInvoice: { select: { invoiceNo: true } },
            },
        })
        if (!request) throw new NotFoundException('PAYMENT_REQUEST_NOT_FOUND')

        const supplier = request.purchaseOrder.supplier
        const amount = Number(request.amountVnd ?? 0)
        const data: PaymentRequestPrintData = {
            cityText: 'Thanh Hóa',
            printDate: new Date(),
            requesterName: 'Lê Thị Hoài',
            requesterDepartment: 'Mua hàng',
            beneficiaryName: request.supplierName || supplier?.name || '',
            beneficiaryAccountNo: '',
            beneficiaryBankName: '',
            totalAmount: amount,
            totalAmountText: this.numberToVietnameseMoney(amount),
            rows: [
                {
                    supplierCode: supplier?.code || '',
                    orderNo: request.purchaseOrder.orderNo,
                    note: request.note || request.supplierInvoice?.invoiceNo || '',
                    amount,
                    content:
                        request.content ||
                        `Thanh toán đề nghị ${request.requestNo} cho ${request.supplierName || supplier?.name || ''}`,
                },
            ],
            bankDepartmentLabel: 'BỘ PHẬN NGÂN HÀNG',
            purchaseDepartmentLabel: 'BỘ PHẬN MUA HÀNG',
            deputyDirectorLabel: 'Phó Giám Đốc',
            requesterLabel: 'Người Đề Nghị',
            deputyDirectorName: 'Nguyễn Ngọc Mai',
            requesterSignName: 'Lê Thị Hoài',
        }
        return this.renderMergedPdfFromHtmls([renderPaymentRequestPrintHtml(data)])
    }

    async printPaymentRequestBatchSync(dto: CreatePurchaseOrderPrintBatchDto): Promise<Buffer> {
        const ids = [...new Set(dto.ids)]

        if (!ids.length) {
            throw new BadRequestException('IDS_REQUIRED')
        }

        const htmls: string[] = []

        for (const id of ids) {
            const data = await this.buildPaymentRequestPrintData(id)
            htmls.push(renderPaymentRequestPrintHtml(data))
        }

        return this.renderMergedPdfFromHtmls(htmls)
    }
}
