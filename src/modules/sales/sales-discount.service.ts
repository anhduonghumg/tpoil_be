import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import {
    MasterStatus,
    PartyRoleType,
    Prisma,
    SalesDiscountBoardStatus,
    SalesOrderKind,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { MailService } from 'src/mail/mail.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import {
    CreateDiscountBoardDto,
    ListDiscountBoardsQueryDto,
    SendDiscountBoardDto,
    UpdateDiscountBoardDto,
} from './dto/sales-discount.dto'

const boardInclude = Prisma.validator<Prisma.SalesDiscountBoardInclude>()({
    lines: {
        include: {
            warehouse: { select: { id: true, code: true, name: true } },
            product: { select: { id: true, code: true, name: true, uom: true } },
        },
        // Thứ tự này quyết định thứ tự trên bản copy gửi khách, nên phải ổn định.
        orderBy: [{ warehouse: { code: 'asc' } }, { product: { code: 'asc' } }],
    },
    recipients: {
        include: { customer: { select: { id: true, code: true, name: true } } },
        orderBy: { email: 'asc' },
    },
})

/**
 * Bảng thông báo chiết khấu theo kho × mặt hàng (prisma/docs/thongbaogia.md).
 *
 * Đây là nguồn chiết khấu khi tạo đơn bán: form tự điền từ bản đang hiệu lực, Sale sửa
 * được từng dòng, và không có chiết khấu thì không gửi duyệt đơn được.
 */
@Injectable()
export class SalesDiscountService {
    private readonly logger = new Logger(SalesDiscountService.name)

    constructor(
        private readonly prisma: PrismaService,
        private readonly mail: MailService,
    ) {}

    /**
     * Bản đang áp dụng tại một thời điểm: bản ĐÃ PHÁT HÀNH có mốc hiệu lực gần nhất mà
     * chưa vượt quá thời điểm đó. Bản phát hành sau tự làm bản trước hết vai trò.
     */
    async effectiveBoardAt(at: Date = new Date(), db: Prisma.TransactionClient | PrismaService = this.prisma) {
        return db.salesDiscountBoard.findFirst({
            where: { status: SalesDiscountBoardStatus.PUBLISHED, effectiveFrom: { lte: at } },
            orderBy: { effectiveFrom: 'desc' },
            include: boardInclude,
        })
    }

    /**
     * Chiết khấu cho từng cặp kho × mặt hàng tại một thời điểm. Trả về Map để nơi gọi
     * hỏi nhiều dòng một lượt thay vì mỗi dòng một truy vấn.
     */
    async resolveDiscounts(
        pairs: Array<{ warehouseId: string; productId: string }>,
        at: Date = new Date(),
        db: Prisma.TransactionClient | PrismaService = this.prisma,
    ) {
        const result = new Map<string, Prisma.Decimal>()
        if (!pairs.length) return result

        const board = await db.salesDiscountBoard.findFirst({
            where: { status: SalesDiscountBoardStatus.PUBLISHED, effectiveFrom: { lte: at } },
            orderBy: { effectiveFrom: 'desc' },
            select: { id: true },
        })
        if (!board) return result

        const lines = await db.salesDiscountBoardLine.findMany({
            where: {
                boardId: board.id,
                OR: pairs.map((pair) => ({
                    warehouseId: pair.warehouseId,
                    productId: pair.productId,
                })),
            },
            select: { warehouseId: true, productId: true, discountPerUnit: true },
        })
        for (const line of lines) {
            result.set(`${line.warehouseId}:${line.productId}`, line.discountPerUnit)
        }
        return result
    }

    async resolveOne(warehouseId: string, productId: string, at: Date = new Date()) {
        const map = await this.resolveDiscounts([{ warehouseId, productId }], at)
        const discount = map.get(`${warehouseId}:${productId}`)
        return {
            warehouseId,
            productId,
            at,
            discountPerUnit: discount == null ? null : discount.toString(),
            /** Không có nghĩa là chưa được bán mặt hàng này ở kho này. */
            hasDiscount: discount != null,
        }
    }

    async list(query: ListDiscountBoardsQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const where: Prisma.SalesDiscountBoardWhereInput = {
            status: query.status ?? undefined,
        }
        const [rows, total, current] = await this.prisma.$transaction([
            this.prisma.salesDiscountBoard.findMany({
                where,
                include: boardInclude,
                orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.salesDiscountBoard.count({ where }),
            this.prisma.salesDiscountBoard.findFirst({
                where: {
                    status: SalesDiscountBoardStatus.PUBLISHED,
                    effectiveFrom: { lte: new Date() },
                },
                orderBy: { effectiveFrom: 'desc' },
                select: { id: true },
            }),
        ])
        return {
            items: rows.map((row) => ({ ...row, isCurrent: row.id === current?.id })),
            total,
            page,
            limit,
            currentBoardId: current?.id ?? null,
        }
    }

    async detail(id: string) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            include: boardInclude,
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        const current = await this.effectiveBoardAt()
        return {
            ...board,
            isCurrent: board.id === current?.id,
            announcementText: this.buildAnnouncementText(board),
        }
    }

    /** Bản nháp mới, mặc định chép nguyên bản đang chạy để chỉ phải sửa ô nào đổi. */
    async create(dto: CreateDiscountBoardDto, actor: ScopedActor) {
        const effectiveFrom = new Date(dto.effectiveFrom)
        if (Number.isNaN(effectiveFrom.getTime())) {
            throw new BadRequestException({
                code: 'EFFECTIVE_FROM_INVALID',
                message: 'Mốc hiệu lực không hợp lệ.',
            })
        }

        let lines = dto.lines
        if (!lines) {
            // Chép từ bản được chỉ định (khi ra bản sửa lại), mặc định là bản đang chạy.
            const source = dto.cloneFromBoardId
                ? await this.prisma.salesDiscountBoard.findUnique({
                      where: { id: dto.cloneFromBoardId },
                      include: boardInclude,
                  })
                : await this.effectiveBoardAt()
            lines = (source?.lines ?? []).map((line) => ({
                warehouseId: line.warehouseId,
                productId: line.productId,
                discountPerUnit: Number(line.discountPerUnit),
                note: line.note ?? undefined,
            }))
        }

        const board = await this.prisma.salesDiscountBoard.create({
            data: {
                status: SalesDiscountBoardStatus.DRAFT,
                effectiveFrom,
                announcerName: dto.announcerName?.trim() || (await this.defaultAnnouncerName()),
                note: dto.note?.trim() || null,
                createdById: actor.userId,
                lines: { create: this.linesCreateInput(lines) },
            },
            select: { id: true },
        })
        return this.detail(board.id)
    }

    async update(id: string, dto: UpdateDiscountBoardDto) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            select: { id: true, status: true },
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        this.assertDraft(board.status)

        await this.prisma.$transaction(async (tx) => {
            const data: Prisma.SalesDiscountBoardUpdateInput = { version: { increment: 1 } }
            if (dto.effectiveFrom !== undefined) {
                const effectiveFrom = new Date(dto.effectiveFrom)
                if (Number.isNaN(effectiveFrom.getTime())) {
                    throw new BadRequestException({
                        code: 'EFFECTIVE_FROM_INVALID',
                        message: 'Mốc hiệu lực không hợp lệ.',
                    })
                }
                data.effectiveFrom = effectiveFrom
            }
            if (dto.announcerName !== undefined) data.announcerName = dto.announcerName?.trim() || null
            if (dto.note !== undefined) data.note = dto.note?.trim() || null
            await tx.salesDiscountBoard.update({ where: { id }, data })

            if (dto.lines) {
                await tx.salesDiscountBoardLine.deleteMany({ where: { boardId: id } })
                const rows = this.linesCreateInput(dto.lines)
                if (rows.length) {
                    await tx.salesDiscountBoardLine.createMany({
                        data: rows.map((row) => ({ ...row, boardId: id })),
                    })
                }
            }
        })
        return this.detail(id)
    }

    /**
     * Phát hành. Từ mốc hiệu lực trở đi, mọi đơn bán lấy chiết khấu từ bản này.
     */
    async publish(id: string, actor: ScopedActor) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            include: { lines: true },
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        this.assertDraft(board.status)
        if (!board.lines.length) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_EMPTY',
                message: 'Bảng chiết khấu chưa có dòng nào để phát hành.',
            })
        }

        await this.prisma.salesDiscountBoard.update({
            where: { id },
            data: {
                status: SalesDiscountBoardStatus.PUBLISHED,
                publishedAt: new Date(),
                publishedById: actor.userId,
                version: { increment: 1 },
            },
        })
        return this.detail(id)
    }

    async cancel(id: string) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            select: { id: true, status: true, effectiveFrom: true },
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        if (
            board.status === SalesDiscountBoardStatus.PUBLISHED &&
            board.effectiveFrom <= new Date()
        ) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_ALREADY_EFFECTIVE',
                message:
                    'Bảng đã có hiệu lực, đơn bán có thể đã dùng chiết khấu này — phải ra bảng mới để sửa, không xóa được quá khứ.',
            })
        }
        await this.prisma.salesDiscountBoard.update({
            where: { id },
            data: { status: SalesDiscountBoardStatus.CANCELLED, version: { increment: 1 } },
        })
        return this.detail(id)
    }

    /**
     * Đưa bản đã phát hành về nháp để sửa. Chỉ được khi CHƯA tới giờ hiệu lực — lúc đó
     * chưa đơn nào dùng tới nó, sửa là an toàn.
     *
     * Đã gửi email cho khách thì vẫn cho sửa (số liệu sai mà để nguyên còn tệ hơn), nhưng
     * danh sách người nhận được giữ lại để biết ai đang cầm bản cũ và phải gửi lại.
     */
    async unpublish(id: string) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            select: { id: true, status: true, effectiveFrom: true, _count: { select: { recipients: true } } },
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        if (board.status !== SalesDiscountBoardStatus.PUBLISHED) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_NOT_PUBLISHED',
                message: 'Chỉ thu hồi được bảng đã phát hành.',
            })
        }
        if (board.effectiveFrom <= new Date()) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_ALREADY_EFFECTIVE',
                message:
                    'Bảng đã tới giờ hiệu lực nên không thu hồi được — hãy ra bảng sửa lại với mốc hiệu lực mới.',
            })
        }

        await this.prisma.salesDiscountBoard.update({
            where: { id },
            data: {
                status: SalesDiscountBoardStatus.DRAFT,
                publishedAt: null,
                publishedById: null,
                version: { increment: 1 },
            },
        })
        return this.detail(id)
    }

    /**
     * Những đơn bán đã gửi duyệt trong lúc bản này đang hiệu lực — tức là những đơn có
     * thể đã ăn phải chiết khấu sai. Cần cho người dùng thấy để còn đi sửa từng đơn.
     */
    async affectedOrders(id: string) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            select: { effectiveFrom: true, status: true },
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        if (board.status !== SalesDiscountBoardStatus.PUBLISHED) return { window: null, items: [] }

        // Bản kế tiếp đóng lại khoảng hiệu lực của bản này.
        const next = await this.prisma.salesDiscountBoard.findFirst({
            where: {
                status: SalesDiscountBoardStatus.PUBLISHED,
                effectiveFrom: { gt: board.effectiveFrom },
            },
            orderBy: { effectiveFrom: 'asc' },
            select: { effectiveFrom: true },
        })

        const items = await this.prisma.salesOrder.findMany({
            where: {
                kind: { in: [SalesOrderKind.SINGLE, SalesOrderKind.LOT] },
                submittedAt: {
                    gte: board.effectiveFrom,
                    ...(next ? { lt: next.effectiveFrom } : {}),
                },
            },
            select: {
                id: true,
                orderNo: true,
                status: true,
                submittedAt: true,
                customer: { select: { id: true, name: true } },
            },
            orderBy: { submittedAt: 'asc' },
            take: 200,
        })

        return {
            window: { from: board.effectiveFrom, to: next?.effectiveFrom ?? null },
            items,
        }
    }

    /** Khách đang hoạt động và có email — danh sách để vận hành tick trước khi gửi. */
    async recipientCandidates() {
        const rows = await this.prisma.party.findMany({
            where: {
                deletedAt: null,
                masterStatus: MasterStatus.ACTIVE,
                roles: { some: { role: PartyRoleType.CUSTOMER, validTo: null } },
                contactEmail: { not: null },
            },
            select: { id: true, code: true, name: true, contactEmail: true },
            orderBy: { name: 'asc' },
        })
        return rows
            .filter((row) => row.contactEmail?.includes('@'))
            .map((row) => ({ ...row, contactEmail: row.contactEmail!.trim() }))
    }

    /**
     * Gửi email cho những khách được chọn. Ghi vết từng người: gửi ra ngoài mà không có
     * dấu vết thì sau này không ai trả lời được "khách này đã nhận chưa".
     */
    async send(id: string, dto: SendDiscountBoardDto) {
        const board = await this.prisma.salesDiscountBoard.findUnique({
            where: { id },
            include: boardInclude,
        })
        if (!board) throw new NotFoundException('SALES_DISCOUNT_BOARD_NOT_FOUND')
        if (board.status !== SalesDiscountBoardStatus.PUBLISHED) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_NOT_PUBLISHED',
                message: 'Phải phát hành bảng chiết khấu trước khi gửi cho khách.',
            })
        }

        const customers = await this.prisma.party.findMany({
            where: { id: { in: dto.customerPartyIds }, deletedAt: null },
            select: { id: true, name: true, contactEmail: true },
        })
        const text = this.buildAnnouncementText(board)
        const subject = `Thông báo chiết khấu từ ${this.timeText(board.effectiveFrom)}`

        let sent = 0
        let failed = 0
        const skipped: string[] = []

        for (const customer of customers) {
            const email = customer.contactEmail?.trim()
            if (!email?.includes('@')) {
                skipped.push(customer.name)
                continue
            }

            const already = await this.prisma.salesDiscountBoardRecipient.findUnique({
                where: { boardId_customerPartyId: { boardId: id, customerPartyId: customer.id } },
                select: { sentAt: true },
            })
            // Không gửi lại cho người đã nhận, trừ khi được yêu cầu rõ ràng.
            if (already?.sentAt && !dto.resend) continue

            let errorMessage: string | null = null
            try {
                await this.mail.sendMail({
                    to: { email, name: customer.name },
                    subject,
                    text,
                    html: `<pre style="font-family:inherit;white-space:pre-wrap">${this.escapeHtml(text)}</pre>`,
                })
                sent += 1
            } catch (error) {
                failed += 1
                errorMessage = error instanceof Error ? error.message : String(error)
                this.logger.error(`Gửi thông báo chiết khấu cho ${email} thất bại: ${errorMessage}`)
            }

            await this.prisma.salesDiscountBoardRecipient.upsert({
                where: { boardId_customerPartyId: { boardId: id, customerPartyId: customer.id } },
                create: {
                    boardId: id,
                    customerPartyId: customer.id,
                    email,
                    sentAt: errorMessage ? null : new Date(),
                    errorMessage,
                },
                update: {
                    email,
                    sentAt: errorMessage ? null : new Date(),
                    errorMessage,
                },
            })
        }

        return { sent, failed, skipped, board: await this.detail(id) }
    }

    // ===== Nội dung thông báo =====

    /** "14h00 ngày 07.8" — đúng cách viết trên thông báo giấy. */
    private timeText(at: Date) {
        const hh = String(at.getHours()).padStart(2, '0')
        const mm = String(at.getMinutes()).padStart(2, '0')
        const dd = String(at.getDate()).padStart(2, '0')
        return `${hh}h${mm} ngày ${dd}.${at.getMonth() + 1}`
    }

    private amountText(value: Prisma.Decimal) {
        return new Intl.NumberFormat('vi-VN').format(Number(value))
    }

    private escapeHtml(input: string) {
        return input
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
    }

    /**
     * Dựng đúng mẫu chữ kinh doanh đang gửi khách, để copy là dán thẳng vào Zalo/email.
     */
    buildAnnouncementText(board: {
        effectiveFrom: Date
        announcerName: string | null
        lines: Array<{
            discountPerUnit: Prisma.Decimal
            warehouse: { name: string }
            product: { name: string }
        }>
    }) {
        const header = `${board.announcerName ?? 'Công ty'} thông báo chiết khấu từ ${this.timeText(
            board.effectiveFrom,
        )} như sau :`

        const byWarehouse = new Map<string, string[]>()
        for (const line of board.lines) {
            const rows = byWarehouse.get(line.warehouse.name) ?? []
            rows.push(`    - ${line.product.name}: ${this.amountText(line.discountPerUnit)} đ/lít`)
            byWarehouse.set(line.warehouse.name, rows)
        }

        const body = [...byWarehouse.entries()].map(
            ([warehouseName, rows], index) => `    ${index + 1}. Kho ${warehouseName}:\n${rows.join('\n')}`,
        )

        return [header, ...body, '    Trân trọng!'].join('\n')
    }

    // ===== Trợ giúp =====

    private assertDraft(status: SalesDiscountBoardStatus) {
        if (status !== SalesDiscountBoardStatus.DRAFT) {
            throw new BadRequestException({
                code: 'DISCOUNT_BOARD_NOT_EDITABLE',
                message: 'Chỉ sửa được bảng chiết khấu ở trạng thái nháp.',
            })
        }
    }

    private linesCreateInput(lines: Array<{
        warehouseId: string
        productId: string
        discountPerUnit: number
        note?: string
    }>) {
        // Cùng một kho × mặt hàng chỉ được một dòng; giữ dòng cuối người dùng nhập.
        const byKey = new Map<string, (typeof lines)[number]>()
        for (const line of lines) {
            byKey.set(`${line.warehouseId}:${line.productId}`, line)
        }
        return [...byKey.values()].map((line) => ({
            warehouseId: line.warehouseId,
            productId: line.productId,
            discountPerUnit: new Prisma.Decimal(line.discountPerUnit),
            note: line.note?.trim() || null,
        }))
    }

    private async defaultAnnouncerName() {
        const legalEntity = await this.prisma.legalEntity.findFirst({
            orderBy: { createdAt: 'asc' },
            select: { party: { select: { name: true } } },
        })
        return legalEntity?.party.name ?? null
    }
}
