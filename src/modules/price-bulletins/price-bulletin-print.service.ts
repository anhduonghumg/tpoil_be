import { Injectable, NotFoundException } from '@nestjs/common'
import { PriceBulletinStatus } from '@prisma/client'
import * as puppeteer from 'puppeteer-core'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { PRICE_NOTICE_WIDTH, renderPriceNoticeHtml } from './templates/price-notice.template'
import { renderPriceDecisionHtml } from './templates/price-decision.template'
import type { PriceDocData, PriceDocRow } from './templates/price-doc.types'
import {
    isPriceDocProduct,
    priceDocProductName,
    priceDocProductOrder,
    priceDocUnit,
} from './templates/price-doc-products'

const PDF_OPTIONS = {
    format: 'A4' as const,
    printBackground: true,
    margin: { top: '8mm', right: '9mm', bottom: '6mm', left: '9mm' },
}

@Injectable()
export class PriceBulletinPrintService {
    constructor(private readonly prisma: PrismaService) {}

    /**
     * Gom dữ liệu để in: bảng giá này, cộng thêm bảng công bố liền TRƯỚC nó để tính giá cũ
     * và mức tăng/giảm. "Liền trước" xét theo `effectiveFrom` chứ không theo ngày tạo —
     * nhập bù một kỳ cũ vẫn phải so với đúng kỳ đứng trước nó.
     */
    async buildPrintData(bulletinId: string): Promise<PriceDocData> {
        const bulletin = await this.prisma.priceBulletin.findUnique({
            where: { id: bulletinId },
            include: {
                items: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        region: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })
        if (!bulletin) throw new NotFoundException('PRICE_BULLETIN_NOT_FOUND')

        const previous = await this.prisma.priceBulletin.findFirst({
            where: {
                id: { not: bulletinId },
                status: PriceBulletinStatus.PUBLISHED,
                effectiveFrom: { lt: bulletin.effectiveFrom },
            },
            orderBy: { effectiveFrom: 'desc' },
            include: { items: { select: { productId: true, regionId: true, price: true } } },
        })
        const oldPriceOf = new Map(
            (previous?.items ?? []).map((item) => [
                `${item.productId}:${item.regionId}`,
                Number(item.price),
            ]),
        )

        // Vùng xếp theo mã để "Vùng I" luôn đứng trước "Vùng II", bất kể thứ tự dòng lưu.
        const regions = [...new Map(bulletin.items.map((item) => [item.region.id, item.region])).values()].sort(
            (a, b) => a.code.localeCompare(b.code, 'vi'),
        )

        const byProduct = new Map<string, PriceDocRow>()
        for (const item of bulletin.items) {
            // Mặt hàng đã ngừng bán vẫn có thể còn giá cũ trong bảng — không đưa lên văn bản.
            if (!isPriceDocProduct(item.product.code)) continue
            const row = byProduct.get(item.product.id) ?? {
                productId: item.product.id,
                productName: priceDocProductName(item.product.code, item.product.name),
                uom: priceDocUnit(item.product.uom),
                cells: [],
                regionGap: null,
            }
            const newPrice = Number(item.price)
            const oldPrice = oldPriceOf.get(`${item.product.id}:${item.region.id}`) ?? null
            row.cells.push({
                regionId: item.region.id,
                newPrice,
                oldPrice,
                delta: oldPrice == null ? null : newPrice - oldPrice,
            })
            byProduct.set(item.product.id, row)
        }

        const rows = [...byProduct.values()]
        for (const row of rows) {
            // Cột "Chênh lệch V2/V1" chỉ có nghĩa khi bảng đúng hai vùng.
            if (regions.length !== 2) continue
            const first = row.cells.find((cell) => cell.regionId === regions[0].id)
            const second = row.cells.find((cell) => cell.regionId === regions[1].id)
            row.regionGap = first && second ? second.newPrice - first.newPrice : null
        }
        // Thứ tự mặt hàng theo mẫu giấy của công ty, không theo thứ tự nhập hay theo mã.
        // Mặt hàng chưa khai trong bảng thứ tự thì xếp sau, giữ nguyên thứ tự lúc nhập.
        const codeOf = new Map(
            bulletin.items.map((item) => [item.product.id, item.product.code] as const),
        )
        const enteredAt = (productId: string) =>
            bulletin.items.findIndex((item) => item.productId === productId)
        rows.sort(
            (a, b) =>
                priceDocProductOrder(codeOf.get(a.productId)) -
                    priceDocProductOrder(codeOf.get(b.productId)) ||
                enteredAt(a.productId) - enteredAt(b.productId),
        )

        return {
            effectiveFrom: bulletin.effectiveFrom,
            decisionNo: bulletin.decisionNo,
            basisDocNo: bulletin.basisDocNo,
            basisDocDate: bulletin.basisDocDate,
            regions,
            rows,
        }
    }

    /** Một trình duyệt cho mỗi lần dựng; đóng trong `finally` để không rò tiến trình. */
    private async withPage<T>(html: string, run: (page: puppeteer.Page) => Promise<T>) {
        let browser: puppeteer.Browser | undefined
        try {
            // Cùng cách khởi chạy với bản in đơn bán: Chrome của máy chủ qua CHROME_PATH.
            browser = await puppeteer.launch({
                executablePath: process.env.CHROME_PATH,
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            })
            const page = await browser.newPage()
            try {
                await page.setContent(html, { waitUntil: 'networkidle0' })
                return await run(page)
            } finally {
                await page.close()
            }
        } finally {
            await browser?.close()
        }
    }

    /** Ảnh thông báo giá — dạng gửi Zalo/Facebook cho khách và đại lý. */
    async renderNoticePng(bulletinId: string) {
        const data = await this.buildPrintData(bulletinId)
        const html = renderPriceNoticeHtml(data)
        const buffer = await this.withPage(html, async (page) => {
            // deviceScaleFactor 2 để ảnh còn nét khi khách phóng to trên điện thoại.
            await page.setViewport({ width: PRICE_NOTICE_WIDTH, height: 800, deviceScaleFactor: 2 })
            // Chụp đúng thẻ body: fullPage lấy chiều cao lớn nhất giữa nội dung và khung
            // nhìn, nên bảng giá ngắn sẽ thừa ra một dải trắng dưới đáy.
            const body = await page.$('body')
            if (!body) throw new Error('PRICE_NOTICE_RENDER_FAILED')
            return Buffer.from(await body.screenshot({ type: 'png' }))
        })
        return { buffer, data }
    }

    /** Quyết định điều chỉnh giá — bản A4 để in, ký và đóng dấu. */
    async renderDecisionPdf(bulletinId: string) {
        const data = await this.buildPrintData(bulletinId)
        const html = renderPriceDecisionHtml(data)
        const buffer = await this.withPage(html, async (page) =>
            Buffer.from(await page.pdf(PDF_OPTIONS)),
        )
        return { buffer, data }
    }

    /** Tên file tải về: bám theo ngày áp dụng để lưu trữ khỏi lẫn kỳ. */
    fileStem(data: PriceDocData, prefix: string) {
        const date = data.effectiveFrom
        const stamp = `${String(date.getDate()).padStart(2, '0')}${String(
            date.getMonth() + 1,
        ).padStart(2, '0')}${date.getFullYear()}`
        return `${prefix}-${stamp}`
    }
}
