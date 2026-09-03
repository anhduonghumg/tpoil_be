import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, SalesLotInvoiceMode, SalesOrderKind } from '@prisma/client'
import { PDFDocument } from 'pdf-lib'
import * as puppeteer from 'puppeteer-core'
import { Browser } from 'puppeteer-core'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { renderSalesOrderPrintHtml } from './templates/sales-order-print.template'
import { SalesOrderPrintData, SalesOrderPrintVariant } from './templates/sales-order-print.types'

const PDF_OPTIONS = {
    format: 'A4' as const,
    printBackground: true,
    margin: { top: '12mm', right: '10mm', bottom: '12mm', left: '10mm' },
}

/** Chặn trên để một lần bấm nhầm không dựng hàng nghìn trang. */
const PRINT_BATCH_LIMIT = 300

@Injectable()
export class SalesOrderPrintService {
    constructor(private readonly prisma: PrismaService) {}

    private decimal(value: Prisma.Decimal | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    /**
     * Mẫu in do loại đơn quyết định; riêng đơn lô còn tách theo cách xuất hóa đơn —
     * hai mẫu giấy chỉ khác nhau đúng dòng "Thời gian xuất hóa đơn".
     */
    private variantOf(order: {
        kind: SalesOrderKind
        lotInvoiceMode: SalesLotInvoiceMode | null
    }): SalesOrderPrintVariant {
        if (order.kind !== SalesOrderKind.LOT) return 'RETAIL'
        return order.lotInvoiceMode === SalesLotInvoiceMode.ON_WITHDRAWAL ? 'LOT_BY_PROGRESS' : 'LOT'
    }

    async buildPrintData(salesOrderId: string): Promise<SalesOrderPrintData> {
        const order = await this.prisma.salesOrder.findUnique({
            where: { id: salesOrderId },
            include: {
                customer: {
                    select: { name: true, taxCode: true, billingAddress: true, shippingAddress: true },
                },
                legalEntity: { select: { party: { select: { name: true } } } },
                lines: {
                    orderBy: { lineNo: 'asc' },
                    include: {
                        product: { select: { name: true, uom: true } },
                        issueWarehouse: { select: { name: true } },
                        receivingWarehouse: { select: { name: true } },
                    },
                },
                paymentPlans: { orderBy: [{ dueDate: 'asc' }, { sortOrder: 'asc' }] },
            },
        })
        if (!order) throw new NotFoundException('SALES_ORDER_NOT_FOUND')

        let totalAmount = new Prisma.Decimal(0)
        const lines = order.lines.map((line, index) => {
            const qty = this.decimal(line.orderedActualQty)
            const unitPrice = this.decimal(line.unitPrice)
            const discountPerUnit = this.decimal(line.discountAmount)
            // Đúng như đơn giấy: thành tiền = SL × (giá bán − chiết khấu mỗi đơn vị).
            const lineTotal = qty.mul(unitPrice.minus(discountPerUnit))
            totalAmount = totalAmount.plus(lineTotal)
            return {
                index: index + 1,
                productName: line.product.name,
                qty: qty.toNumber(),
                unitPrice: unitPrice.toNumber(),
                discountPerUnit: discountPerUnit.toNumber(),
                lineTotal: lineTotal.toNumber(),
                vehiclePlate: line.vehiclePlate ?? '',
                driverName: line.driverName ?? '',
                warehouseName: line.issueWarehouse?.name ?? line.receivingWarehouse?.name ?? '',
            }
        })

        const paymentPlans = order.paymentPlans.map((plan) => ({
            dueDate: plan.dueDate,
            percent: plan.percent?.toNumber() ?? null,
            amount: plan.amount?.toNumber() ?? totalAmount.mul(plan.percent ?? 0).div(100).toNumber(),
        }))

        return {
            variant: this.variantOf(order),
            orderNo: order.orderNo,
            orderDate: order.orderDate,
            buyerName: order.customer.name,
            buyerTaxCode: order.customer.taxCode ?? '',
            buyerAddress: order.customer.billingAddress ?? order.customer.shippingAddress ?? '',
            sellerName: order.legalEntity.party.name,
            uomText: order.lines[0]?.product.uom ?? 'lít',
            paymentMethodText: 'Chuyển khoản',
            paymentTermType: order.paymentTermType,
            receiveDateText: this.receiveDateText(order.orderDate),
            totalAmount: totalAmount.toNumber(),
            lines,
            paymentPlans,
        }
    }

    private receiveDateText(orderDate: Date) {
        const dd = String(orderDate.getDate()).padStart(2, '0')
        const mm = String(orderDate.getMonth() + 1).padStart(2, '0')
        return `Ngày ${dd}-${mm}-${orderDate.getFullYear()}`
    }

    /**
     * Một lần mở Chromium cho cả tập đơn, rồi ghép thành một file.
     *
     * Kế toán thường in cả tháng của một khách, nên mở/đóng trình duyệt cho từng đơn là
     * chỗ tốn thời gian nhất — gom lại giúp in 50 đơn nhanh gần bằng in 1 đơn.
     */
    private async renderMergedPdf(htmls: string[]): Promise<Buffer> {
        let browser: Browser | null = null
        try {
            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            })

            if (htmls.length === 1) {
                const page = await browser.newPage()
                try {
                    await page.setContent(htmls[0], { waitUntil: 'networkidle0' })
                    return Buffer.from(await page.pdf(PDF_OPTIONS))
                } finally {
                    await page.close()
                }
            }

            const merged = await PDFDocument.create()
            for (const html of htmls) {
                const page = await browser.newPage()
                try {
                    await page.setContent(html, { waitUntil: 'networkidle0' })
                    const part = await PDFDocument.load(await page.pdf(PDF_OPTIONS))
                    const pages = await merged.copyPages(part, part.getPageIndices())
                    for (const one of pages) merged.addPage(one)
                } finally {
                    await page.close()
                }
            }
            return Buffer.from(await merged.save())
        } finally {
            if (browser) await browser.close()
        }
    }

    async renderPdf(salesOrderId: string): Promise<{ buffer: Buffer; orderNo: string }> {
        const data = await this.buildPrintData(salesOrderId)
        const buffer = await this.renderMergedPdf([renderSalesOrderPrintHtml(data)])
        return { buffer, orderNo: data.orderNo }
    }

    /**
     * In hàng loạt: theo danh sách đơn đã chọn, hoặc theo khách + khoảng ngày.
     * Sắp theo ngày rồi số đơn để tập in ra đúng thứ tự sổ sách.
     */
    async renderBatchPdf(filter: {
        ids?: string[]
        customerPartyId?: string
        dateFrom?: string
        dateTo?: string
        kind?: SalesOrderKind
    }): Promise<{ buffer: Buffer; count: number }> {
        const hasIds = !!filter.ids?.length
        const hasFilter = !!(filter.customerPartyId || filter.dateFrom || filter.dateTo)
        if (!hasIds && !hasFilter) {
            throw new BadRequestException({
                code: 'PRINT_BATCH_FILTER_REQUIRED',
                message: 'Phải chọn đơn cần in, hoặc lọc theo khách hàng và khoảng ngày.',
            })
        }

        const orders = await this.prisma.salesOrder.findMany({
            where: {
                ...(hasIds ? { id: { in: filter.ids } } : {}),
                customerPartyId: filter.customerPartyId ?? undefined,
                kind: filter.kind ?? undefined,
                ...(filter.dateFrom || filter.dateTo
                    ? {
                          orderDate: {
                              gte: filter.dateFrom ? new Date(filter.dateFrom) : undefined,
                              lte: filter.dateTo ? new Date(filter.dateTo) : undefined,
                          },
                      }
                    : {}),
            },
            orderBy: [{ orderDate: 'asc' }, { orderNo: 'asc' }],
            select: { id: true },
            take: PRINT_BATCH_LIMIT,
        })
        if (!orders.length) {
            throw new BadRequestException({
                code: 'PRINT_BATCH_EMPTY',
                message: 'Không có đơn nào khớp điều kiện in.',
            })
        }

        const htmls: string[] = []
        for (const order of orders) {
            htmls.push(renderSalesOrderPrintHtml(await this.buildPrintData(order.id)))
        }
        return { buffer: await this.renderMergedPdf(htmls), count: orders.length }
    }
}
