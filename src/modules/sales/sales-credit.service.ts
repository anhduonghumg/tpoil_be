import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PartyRoleType, Prisma, ReceivableOpenItemStatus, SalesOrderStatus } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { ScopedActor } from './sales-warehouse-scope.service'
import { startOfToday } from './receivables.service'
import { ListCreditCustomersQueryDto, UpdateCustomerCreditDto } from './dto/sales-credit.dto'

const openStatuses: ReceivableOpenItemStatus[] = [
    ReceivableOpenItemStatus.OPEN,
    ReceivableOpenItemStatus.PARTIALLY_SETTLED,
]

/** Đơn đã duyệt nhưng chưa thành hóa đơn vẫn đang chiếm hạn mức (spec v1.2 §5.2). */
const committedOrderStatuses: SalesOrderStatus[] = [
    SalesOrderStatus.CONFIRMED,
    SalesOrderStatus.AWAITING_STOCK,
    SalesOrderStatus.PARTIALLY_RESERVED,
    SalesOrderStatus.RESERVED,
    SalesOrderStatus.WAREHOUSE_PROCESSING,
    SalesOrderStatus.PARTIALLY_DELIVERED,
    SalesOrderStatus.DELIVERED,
    SalesOrderStatus.AWAITING_RECONCILIATION,
    SalesOrderStatus.AWAITING_INVOICE,
]

/**
 * Cấu hình tín dụng khách hàng — màn hình của kế toán công nợ (không phải của Sale).
 *
 * Hạn mức nằm sẵn trên Party; ở đây chỉ gom lại cùng số đang dùng thật (công nợ chưa
 * thu + đơn đã duyệt chưa xuất hóa đơn) để người đặt hạn mức nhìn thấy hệ quả, và mọi
 * lần sửa đều ghi vào CreditLimitHistory.
 */
@Injectable()
export class SalesCreditService {
    constructor(private readonly prisma: PrismaService) {}

    private decimal(value: Prisma.Decimal | number | string | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    /** Hạn mức tạm chỉ có hiệu lực trong khoảng ngày của nó. */
    private effectiveLimitOf(customer: {
        creditLimit: Prisma.Decimal | null
        tempLimit: Prisma.Decimal | null
        tempFrom: Date | null
        tempTo: Date | null
    }) {
        const now = startOfToday()
        const tempActive =
            customer.tempLimit != null &&
            (customer.tempFrom == null || customer.tempFrom <= now) &&
            (customer.tempTo == null || customer.tempTo >= now)
        if (tempActive) return { limit: customer.tempLimit, isTemp: true }
        return { limit: customer.creditLimit, isTemp: false }
    }

    /**
     * Giá trị chưa thuế của các dòng đơn — cùng công thức với bước kiểm tra khi gửi duyệt.
     * Chiết khấu tính trên mỗi đơn vị.
     */
    private orderValue(lines: Array<{ orderedActualQty: Prisma.Decimal; unitPrice: Prisma.Decimal; discountAmount: Prisma.Decimal | null }>) {
        return lines.reduce(
            (sum, line) =>
                sum.plus(line.orderedActualQty.mul(line.unitPrice.minus(this.decimal(line.discountAmount)))),
            new Prisma.Decimal(0),
        )
    }

    async list(query: ListCreditCustomersQueryDto) {
        const page = Math.max(query.page ?? 1, 1)
        const limit = Math.min(Math.max(query.limit ?? 20, 1), 100)
        const keyword = query.keyword?.trim()

        const where: Prisma.PartyWhereInput = {
            // Chỉ đối tác đang giữ vai trò khách hàng mới có hạn mức bán chịu.
            roles: { some: { role: PartyRoleType.CUSTOMER, validTo: null } },
            deletedAt: null,
            accountingOwnerEmpId: query.accountingOwnerEmpId ?? undefined,
            ...(query.missingLimitOnly ? { creditLimit: null } : {}),
            ...(keyword
                ? {
                      OR: [
                          { name: { contains: keyword, mode: 'insensitive' } },
                          { code: { contains: keyword, mode: 'insensitive' } },
                          { taxCode: { contains: keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.party.findMany({
                where,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    taxCode: true,
                    creditLimit: true,
                    tempLimit: true,
                    tempFrom: true,
                    tempTo: true,
                    paymentTermDays: true,
                    accountingOwnerEmp: { select: { id: true, code: true, fullName: true } },
                },
                orderBy: [{ name: 'asc' }],
                skip: (page - 1) * limit,
                take: limit,
            }),
            this.prisma.party.count({ where }),
        ])

        const customerIds = rows.map((row) => row.id)
        const enriched = await this.exposureOf(customerIds)

        let items = rows.map((row) => {
            const usage = enriched.get(row.id) ?? {
                receivableOutstanding: new Prisma.Decimal(0),
                overdueAmount: new Prisma.Decimal(0),
                committedOrderValue: new Prisma.Decimal(0),
            }
            const exposure = usage.receivableOutstanding.plus(usage.committedOrderValue)
            const { limit: effectiveLimit, isTemp } = this.effectiveLimitOf(row)
            return {
                ...row,
                effectiveLimit: effectiveLimit == null ? null : effectiveLimit.toString(),
                effectiveLimitIsTemp: isTemp,
                receivableOutstanding: usage.receivableOutstanding.toString(),
                overdueAmount: usage.overdueAmount.toString(),
                committedOrderValue: usage.committedOrderValue.toString(),
                exposure: exposure.toString(),
                availableCredit:
                    effectiveLimit == null ? null : new Prisma.Decimal(effectiveLimit).minus(exposure).toString(),
                isOverLimit: effectiveLimit != null && exposure.greaterThan(new Prisma.Decimal(effectiveLimit)),
                hasOverdue: usage.overdueAmount.greaterThan(0),
            }
        })

        // Hai bộ lọc này tính từ số dư nên phải lọc sau khi đã tổng hợp; total giữ nguyên
        // theo điều kiện truy vấn để phân trang không nhảy lung tung.
        if (query.overdueOnly) items = items.filter((row) => row.hasOverdue)
        if (query.overLimitOnly) items = items.filter((row) => row.isOverLimit)

        return { items, total, page, limit }
    }

    /** Công nợ chưa thu + đơn đã duyệt chưa xuất hóa đơn, gom theo khách. */
    private async exposureOf(customerIds: string[]) {
        const result = new Map<
            string,
            {
                receivableOutstanding: Prisma.Decimal
                overdueAmount: Prisma.Decimal
                committedOrderValue: Prisma.Decimal
            }
        >()
        if (!customerIds.length) return result

        const now = startOfToday()
        const [receivables, orders] = await Promise.all([
            this.prisma.receivableOpenItem.findMany({
                where: {
                    customerPartyId: { in: customerIds },
                    status: { in: openStatuses },
                    settlementType: 'RECEIVABLE',
                },
                select: { customerPartyId: true, outstandingAmount: true, dueDate: true },
            }),
            this.prisma.salesOrder.findMany({
                where: {
                    customerPartyId: { in: customerIds },
                    status: { in: committedOrderStatuses },
                    // Đơn đã lên hóa đơn thì phần nợ đã nằm ở receivable, đếm nữa là trùng.
                    invoices: { none: { status: { not: 'CANCELLED' } } },
                },
                select: {
                    customerPartyId: true,
                    lines: {
                        select: { orderedActualQty: true, unitPrice: true, discountAmount: true },
                    },
                },
            }),
        ])

        const ensure = (customerId: string) => {
            const current = result.get(customerId) ?? {
                receivableOutstanding: new Prisma.Decimal(0),
                overdueAmount: new Prisma.Decimal(0),
                committedOrderValue: new Prisma.Decimal(0),
            }
            result.set(customerId, current)
            return current
        }

        for (const item of receivables) {
            const row = ensure(item.customerPartyId)
            row.receivableOutstanding = row.receivableOutstanding.plus(item.outstandingAmount)
            if (item.dueDate && item.dueDate < now) {
                row.overdueAmount = row.overdueAmount.plus(item.outstandingAmount)
            }
        }
        for (const order of orders) {
            const row = ensure(order.customerPartyId)
            row.committedOrderValue = row.committedOrderValue.plus(this.orderValue(order.lines))
        }
        return result
    }

    /**
     * Dựng dòng thời gian hạn mức từ nhật ký thay đổi: mỗi mốc thay đổi mở một kỳ mới
     * và đóng kỳ trước đó, kỳ cuối cùng là kỳ đang áp dụng.
     *
     * Không cần bảng riêng — nhật ký đã đủ dữ kiện, và suy ra từ nó thì không bao giờ
     * lệch với chính lịch sử đã ghi.
     */
    private buildTimeline(
        history: Array<{
            id: string
            newLimit: Prisma.Decimal | null
            oldLimit: Prisma.Decimal | null
            tempLimit: Prisma.Decimal | null
            tempFrom: Date | null
            tempTo: Date | null
            reason: string | null
            changedBy: string
            changedAt: Date
        }>,
        customerCreatedAt: Date,
        changedByNames: Map<string, string>,
    ) {
        // Nhật ký trả về mới nhất trước; dựng kỳ thì cần cũ nhất trước.
        const ascending = [...history].sort((a, b) => a.changedAt.getTime() - b.changedAt.getTime())
        const periods: Array<{
            id: string
            creditLimit: string | null
            tempLimit: string | null
            tempFrom: Date | null
            tempTo: Date | null
            validFrom: Date
            validTo: Date | null
            isCurrent: boolean
            reason: string | null
            changedBy: string
            changedByName: string | null
        }> = []

        // Kỳ đầu tiên: hạn mức đã có TRƯỚC lần thay đổi được ghi nhận sớm nhất.
        const first = ascending[0]
        if (first && first.oldLimit != null) {
            periods.push({
                id: `${first.id}:initial`,
                creditLimit: first.oldLimit.toString(),
                tempLimit: null,
                tempFrom: null,
                tempTo: null,
                validFrom: customerCreatedAt,
                validTo: first.changedAt,
                isCurrent: false,
                reason: 'Hạn mức có trước khi hệ thống bắt đầu ghi lịch sử',
                changedBy: '',
                changedByName: null,
            })
        }

        ascending.forEach((entry, index) => {
            const next = ascending[index + 1]
            periods.push({
                id: entry.id,
                creditLimit: entry.newLimit == null ? null : entry.newLimit.toString(),
                tempLimit: entry.tempLimit == null ? null : entry.tempLimit.toString(),
                tempFrom: entry.tempFrom,
                tempTo: entry.tempTo,
                validFrom: entry.changedAt,
                validTo: next ? next.changedAt : null,
                isCurrent: !next,
                reason: entry.reason,
                changedBy: entry.changedBy,
                changedByName: changedByNames.get(entry.changedBy) ?? null,
            })
        })

        // Mới nhất lên đầu cho dễ đọc.
        return periods.reverse()
    }

    async detail(customerPartyId: string) {
        const customer = await this.prisma.party.findUnique({
            where: { id: customerPartyId },
            select: {
                id: true,
                code: true,
                name: true,
                taxCode: true,
                createdAt: true,
                creditLimit: true,
                tempLimit: true,
                tempFrom: true,
                tempTo: true,
                paymentTermDays: true,
                accountingOwnerEmp: { select: { id: true, code: true, fullName: true } },
                salesOwnerEmp: { select: { id: true, code: true, fullName: true } },
            },
        })
        if (!customer) throw new NotFoundException('CUSTOMER_NOT_FOUND')

        const [usage, history] = await Promise.all([
            this.exposureOf([customerPartyId]),
            this.prisma.creditLimitHistory.findMany({
                where: { customerId: customerPartyId },
                orderBy: { changedAt: 'desc' },
                take: 100,
            }),
        ])

        // changedBy lưu userId; đổi sang tên người để bảng lịch sử đọc được.
        const changerIds = [...new Set(history.map((row) => row.changedBy).filter((id) => id && id !== 'system'))]
        const changers = changerIds.length
            ? await this.prisma.user.findMany({
                  where: { id: { in: changerIds } },
                  select: { id: true, name: true, username: true },
              })
            : []
        const changedByNames = new Map(changers.map((row) => [row.id, row.name ?? row.username]))

        const current = usage.get(customerPartyId) ?? {
            receivableOutstanding: new Prisma.Decimal(0),
            overdueAmount: new Prisma.Decimal(0),
            committedOrderValue: new Prisma.Decimal(0),
        }
        const exposure = current.receivableOutstanding.plus(current.committedOrderValue)
        const { limit: effectiveLimit, isTemp } = this.effectiveLimitOf(customer)

        return {
            ...customer,
            effectiveLimit: effectiveLimit == null ? null : effectiveLimit.toString(),
            effectiveLimitIsTemp: isTemp,
            receivableOutstanding: current.receivableOutstanding.toString(),
            overdueAmount: current.overdueAmount.toString(),
            committedOrderValue: current.committedOrderValue.toString(),
            exposure: exposure.toString(),
            availableCredit:
                effectiveLimit == null ? null : new Prisma.Decimal(effectiveLimit).minus(exposure).toString(),
            isOverLimit: effectiveLimit != null && exposure.greaterThan(new Prisma.Decimal(effectiveLimit)),
            /** Hạn mức nào áp dụng từ khi nào đến khi nào; kỳ cuối là kỳ đang chạy. */
            timeline: this.buildTimeline(history, customer.createdAt, changedByNames),
            history,
        }
    }

    /**
     * Sửa hạn mức. Ghi lịch sử trong cùng transaction: một thay đổi không có vết là một
     * thay đổi không ai chịu trách nhiệm.
     */
    async update(customerPartyId: string, dto: UpdateCustomerCreditDto, actor: ScopedActor) {
        const reason = dto.reason?.trim()
        if (!reason) {
            throw new BadRequestException({
                code: 'CREDIT_REASON_REQUIRED',
                message: 'Thay đổi hạn mức bắt buộc ghi lý do.',
            })
        }

        const tempFrom = dto.tempFrom == null ? dto.tempFrom : new Date(dto.tempFrom)
        const tempTo = dto.tempTo == null ? dto.tempTo : new Date(dto.tempTo)
        if (tempFrom && tempTo && tempFrom > tempTo) {
            throw new BadRequestException({
                code: 'TEMP_LIMIT_RANGE_INVALID',
                message: 'Ngày bắt đầu hạn mức tạm phải trước ngày kết thúc.',
            })
        }
        if (dto.tempLimit != null && !tempTo) {
            throw new BadRequestException({
                code: 'TEMP_LIMIT_END_REQUIRED',
                message: 'Hạn mức tạm phải có ngày kết thúc, nếu không nó thành hạn mức chính thức.',
            })
        }

        return this.prisma.$transaction(async (tx) => {
            const before = await tx.party.findUnique({
                where: { id: customerPartyId },
                select: { id: true, creditLimit: true, tempLimit: true, tempFrom: true, tempTo: true },
            })
            if (!before) throw new NotFoundException('CUSTOMER_NOT_FOUND')

            const updated = await tx.party.update({
                where: { id: customerPartyId },
                data: {
                    creditLimit: dto.creditLimit === undefined ? undefined : dto.creditLimit,
                    tempLimit: dto.tempLimit === undefined ? undefined : dto.tempLimit,
                    tempFrom: dto.tempFrom === undefined ? undefined : tempFrom,
                    tempTo: dto.tempTo === undefined ? undefined : tempTo,
                    paymentTermDays:
                        dto.paymentTermDays === undefined ? undefined : dto.paymentTermDays,
                },
                select: {
                    id: true,
                    creditLimit: true,
                    tempLimit: true,
                    tempFrom: true,
                    tempTo: true,
                    paymentTermDays: true,
                },
            })

            await tx.creditLimitHistory.create({
                data: {
                    customerId: customerPartyId,
                    oldLimit: before.creditLimit,
                    newLimit: updated.creditLimit,
                    tempLimit: updated.tempLimit,
                    tempFrom: updated.tempFrom,
                    tempTo: updated.tempTo,
                    reason,
                    changedBy: actor.userId ?? 'system',
                },
            })

            return updated
        })
    }
}
