import { BadRequestException, Injectable } from '@nestjs/common'
import { ContractKind, ContractStatus, Prisma, SalesAliasEntityType, SalesOrderKind } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { DeepSeekClientService } from 'src/infra/deepseek/deepseek-client.service'
import { SalesAliasService, AliasCandidate } from '../sales-alias.service'
import { SalesOrderWorkflowService } from '../sales-order-workflow.service'
import { SalesWithdrawalsService } from '../sales-withdrawals.service'
import { ScopedActor } from '../sales-warehouse-scope.service'
import { parseQuickEntry, ParsedOrderKind, parseLocalizedNumber } from './quick-entry.parser'
import { ConfirmQuickEntryDto, ParseQuickEntryDto } from '../dto/sales-quick-entry.dto'

/** One field of the preview: what we read, what it resolved to, and how sure we are. */
type ResolvedField = {
    rawText: string | null
    entityId: string | null
    entityCode: string | null
    entityName: string | null
    confidence: number
    matchedBy: string | null
    candidates: AliasCandidate[]
    needsAttention: boolean
}

/**
 * The quick-entry box: sales pastes what the customer sent, the system proposes a draft.
 *
 * Order of work is deliberate (spec v1.2 §5): clean → regex → match against our own master
 * data → only if something is still missing, ask DeepSeek → match its answer against master
 * data too → show a preview. Nothing is written until sales confirms, and the AI never gets
 * to decide which customer, depot, product or source lot is meant.
 */
@Injectable()
export class SalesQuickEntryService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly aliases: SalesAliasService,
        private readonly deepSeek: DeepSeekClientService,
        private readonly workflow: SalesOrderWorkflowService,
        private readonly withdrawals: SalesWithdrawalsService,
    ) {}

    private empty(rawText: string | null): ResolvedField {
        return {
            rawText,
            entityId: null,
            entityCode: null,
            entityName: null,
            confidence: 0,
            matchedBy: null,
            candidates: [],
            needsAttention: true,
        }
    }

    /** Quick entry must never create a sales order or withdrawal for a customer without a valid sales contract. */
    private async assertActiveSalesContract(customerPartyId: string, orderDate: Date) {
        const contract = await this.prisma.contract.findFirst({
            where: {
                customerId: customerPartyId,
                kind: ContractKind.SALES,
                status: ContractStatus.Active,
                deletedAt: null,
                startDate: { lte: orderDate },
                endDate: { gte: orderDate },
            },
            select: { id: true },
        })
        if (!contract) {
            throw new BadRequestException({
                code: 'SALES_CONTRACT_REQUIRED',
                message: 'Khách hàng chưa có hợp đồng bán đang hiệu lực. Không thể tạo đơn.',
                detail: { customerPartyId, orderDate: orderDate.toISOString() },
            })
        }
    }

    private async resolve(entityType: SalesAliasEntityType, rawText: string | null): Promise<ResolvedField> {
        if (!rawText?.trim()) return this.empty(rawText)
        const match = await this.aliases.match(entityType, rawText)
        if (match.ok) {
            const entity = await this.entityLabel(entityType, match.entityId)
            return {
                rawText,
                entityId: match.entityId,
                entityCode: entity?.code ?? null,
                entityName: entity?.name ?? null,
                confidence: match.confidence,
                matchedBy: match.matchedBy,
                candidates: [],
                // Anything short of an exact mapping still gets a second pair of eyes.
                needsAttention: match.confidence < 0.95,
            }
        }
        return {
            rawText,
            entityId: null,
            entityCode: null,
            entityName: null,
            confidence: 0,
            matchedBy: match.reason,
            candidates: match.candidates,
            needsAttention: true,
        }
    }

    /** Screens show the code, so hand back both rather than making them look it up. */
    private async entityLabel(entityType: SalesAliasEntityType, id: string) {
        const select = { code: true, name: true }
        if (entityType === SalesAliasEntityType.PARTY) {
            return this.prisma.party.findUnique({ where: { id }, select })
        }
        if (entityType === SalesAliasEntityType.WAREHOUSE) {
            return this.prisma.warehouse.findUnique({ where: { id }, select })
        }
        return this.prisma.product.findUnique({ where: { id }, select })
    }

    /** Đối ứng không đọc được từ tin nhắn nên Sale tự chọn; ba loại còn lại từ mẫu. */
    private orderKindOf(kind: ParsedOrderKind | 'DAY_TRADE' | null) {
        if (kind === 'SINGLE') return SalesOrderKind.SINGLE
        if (kind === 'LOT') return SalesOrderKind.LOT
        if (kind === 'DAY_TRADE') return SalesOrderKind.DAY_TRADE
        return null
    }

    /** Reads the paste and proposes a draft. Writes nothing except the log. */
    async parse(dto: ParseQuickEntryDto, actor: ScopedActor) {
        const rawText = dto.text?.trim()
        if (!rawText) throw new BadRequestException('QUICK_ENTRY_TEXT_EMPTY')

        let parsed = parseQuickEntry(rawText)
        let usedAi = false

        // Regex first; AI only fills genuine gaps (spec v1.2 nguyên tắc 12), and only
        // when the caller asked for it so the screen stays in control of the cost.
        const incomplete =
            !parsed.customerText ||
            !parsed.lines.length ||
            parsed.lines.some((line) => !line.productText || line.quantity == null)
        if (dto.useAi && incomplete && this.deepSeek.isEnabled) {
            const ai = await this.deepSeek.normalize(rawText)
            if (ai) {
                usedAi = true
                parsed = {
                    ...parsed,
                    customerText: parsed.customerText || (ai.customer?.trim() || null),
                    plateText: parsed.plateText || (ai.plate?.trim() || null),
                    driverText: parsed.driverText || (ai.driver?.trim() || null),
                    orderKind: parsed.orderKind,
                    lines: parsed.lines.length
                        ? parsed.lines
                        : (ai.lines ?? [])
                              .filter((line) => line.product?.trim())
                              .map((line) => ({
                                  productText: line.product!.trim(),
                                   quantity: parseLocalizedNumber(line.quantity ?? ''),
                                   quantityText: line.quantity ?? '',
                                   warehouseText: line.warehouse?.trim() || null,
                                   orderKind: null,
                              })),
                }
            }
        }

        const customer = await this.resolve(SalesAliasEntityType.PARTY, parsed.customerText)
        const lines = await Promise.all(
            parsed.lines.map(async (line) => ({
                product: await this.resolve(SalesAliasEntityType.PRODUCT, line.productText),
                warehouse: await this.resolve(SalesAliasEntityType.WAREHOUSE, line.warehouseText),
                quantity: line.quantity,
                quantityText: line.quantityText,
                orderKind: line.orderKind ?? parsed.orderKind,
                needsAttention: line.quantity == null,
            })),
        )

        // Everything the matcher could not place: the backlog for alias maintenance.
        const unmatched: Array<{ entityType: string; text: string }> = []
        if (customer.needsAttention && customer.rawText) {
            unmatched.push({ entityType: 'PARTY', text: customer.rawText })
        }
        for (const line of lines) {
            if (line.product.needsAttention && line.product.rawText) {
                unmatched.push({ entityType: 'PRODUCT', text: line.product.rawText })
            }
            if (line.warehouse.needsAttention && line.warehouse.rawText) {
                unmatched.push({ entityType: 'WAREHOUSE', text: line.warehouse.rawText })
            }
        }

        const warnings: string[] = []
        if (usedAi) warnings.push('Đã dùng AI để bổ sung thông tin — vui lòng kiểm tra kỹ.')
        if (!this.deepSeek.isEnabled && incomplete) {
            warnings.push('Chưa cấu hình AI hỗ trợ, kết quả chỉ từ nhận dạng mẫu.')
        }
        if (parsed.leftovers.length) {
            warnings.push(`Không hiểu được: ${parsed.leftovers.join(' | ')}`)
        }

        const orderDate = this.orderDateFrom(parsed.dateText)
        const duplicate = await this.findDuplicate(customer.entityId, parsed.plateText, lines, orderDate)
        if (duplicate) {
            warnings.push(`Có thể trùng với đơn ${duplicate} cùng ngày (cùng khách, xe, hàng và số lượng).`)
        }

        const log = await this.prisma.salesQuickEntryLog.create({
            data: {
                rawText,
                parsed: parsed as unknown as Prisma.InputJsonObject,
                usedAi,
                unmatched: unmatched.length ? (unmatched as unknown as Prisma.InputJsonObject) : Prisma.DbNull,
                createdById: actor.userId,
            },
            select: { id: true },
        })

        return {
            logId: log.id,
            usedAi,
            orderKind: parsed.orderKind,
            messageNo: parsed.messageNo,
            orderDate,
            customer,
            plate: parsed.plateText,
            driver: parsed.driverText,
            lines,
            warnings,
            // The screen should stop and ask whenever anything here is true.
            requiresReview:
                customer.needsAttention ||
                !parsed.orderKind ||
                !lines.length ||
                lines.some((line) => line.needsAttention || line.product.needsAttention || line.warehouse.needsAttention),
        }
    }

    /**
     * Orders sent late in the day are usually meant for tomorrow, so that is proposed — the
     * sale can always change it.
     */
    private suggestOrderDate() {
        const cutoffHour = Number(process.env.SALES_ORDER_DATE_CUTOFF_HOUR ?? 15)
        const now = new Date()
        if (now.getHours() >= cutoffHour) now.setDate(now.getDate() + 1)
        return now.toISOString().slice(0, 10)
    }

    /**
     * Customers write "14/7" far more often than a full date, so a missing year means
     * this year and a missing date altogether falls back to the suggested one.
     */
    private orderDateFrom(dateText: string | null) {
        const raw = dateText?.trim()
        if (!raw) return this.suggestOrderDate()

        const match = raw.match(/^(\d{1,2})\s*[/\-.]\s*(\d{1,2})(?:\s*[/\-.]\s*(\d{2}|\d{4}))?$/)
        if (!match) return this.suggestOrderDate()

        const day = Number(match[1])
        const month = Number(match[2])
        if (day < 1 || day > 31 || month < 1 || month > 12) return this.suggestOrderDate()

        const currentYear = new Date().getFullYear()
        let year = currentYear
        if (match[3]) {
            const parsedYear = Number(match[3])
            year = match[3].length === 2 ? 2000 + parsedYear : parsedYear
        }

        const candidate = new Date(Date.UTC(year, month - 1, day))
        // Reject impossible days such as 31/02 rather than letting them roll over.
        if (candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
            return this.suggestOrderDate()
        }
        return candidate.toISOString().slice(0, 10)
    }

    /** Same customer, plate, product and quantity on the same day is usually a re-paste. */
    private async findDuplicate(
        customerPartyId: string | null,
        plate: string | null,
        lines: Array<{ product: ResolvedField; quantity: number | null }>,
        orderDate: string,
    ) {
        if (!customerPartyId || !plate) return null
        const first = lines[0]
        if (!first?.product.entityId || first.quantity == null) return null

        const existing = await this.prisma.salesOrder.findFirst({
            where: {
                customerPartyId,
                orderDate: new Date(orderDate),
                status: { notIn: ['CANCELLED', 'REJECTED'] },
                lines: {
                    some: {
                        productId: first.product.entityId,
                        orderedActualQty: new Prisma.Decimal(first.quantity),
                        vehiclePlate: plate,
                    },
                },
            },
            select: { orderNo: true },
        })
        return existing?.orderNo ?? null
    }

    /**
     * Creates the draft from what the sale confirmed — their corrections, not the parser's
     * guesses — and remembers any spelling they resolved by hand so the next paste matches.
     */
    async confirm(dto: ConfirmQuickEntryDto, actor: ScopedActor) {
        if (!dto.lines?.length) throw new BadRequestException('QUICK_ENTRY_LINES_REQUIRED')
        for (const line of dto.lines) {
            if (Boolean(line.warehouseId) === Boolean(line.warehouseAreaId)) {
                throw new BadRequestException({
                    code: 'QUICK_ENTRY_WAREHOUSE_SCOPE_INVALID',
                    message: 'Mỗi dòng hàng phải chọn đúng một kho cụ thể hoặc một khu vực.',
                })
            }
            // Phiếu rút phải xuất từ một kho có thật; khu vực không đủ để trừ tồn.
            if (dto.orderKind === 'WITHDRAWAL' && !line.warehouseId) {
                throw new BadRequestException({
                    code: 'QUICK_ENTRY_WITHDRAWAL_WAREHOUSE_REQUIRED',
                    message: 'Phiếu rút tồn phải chọn kho cụ thể, không nhận khu vực.',
                })
            }
        }
        const orderDate = dto.orderDate ? new Date(dto.orderDate) : new Date()
        if (Number.isNaN(orderDate.getTime())) throw new BadRequestException('ORDER_DATE_INVALID')
        await this.assertActiveSalesContract(dto.customerPartyId, orderDate)

        // Chỉ những cách viết Sale đã tick mới gửi kèm rawText, nên gửi rawText chính là
        // đồng ý ghi nhớ. learnAliases=false vẫn là công tắc tổng để tắt hết.
        const learnedAliases = dto.learnAliases === false ? [] : await this.learnFrom(dto, actor)

        const created =
            dto.orderKind === 'WITHDRAWAL'
                ? await this.withdrawals.create(
                      {
                          customerPartyId: dto.customerPartyId,
                          requestDate: dto.orderDate,
                          vehiclePlate: dto.vehiclePlate ?? '',
                          driverName: dto.driverName ?? '',
                          lines: dto.lines.map((line) => ({
                              productId: line.productId,
                              warehouseId: line.warehouseId!,
                              requestedQty: line.quantity,
                          })),
                      } as never,
                      actor,
                  )
                : await this.workflow.createInternal(
                      {
                          customerPartyId: dto.customerPartyId,
                          kind: this.orderKindOf(dto.orderKind as ParsedOrderKind)!,
                          orderDate: dto.orderDate,
                          lotInvoiceMode: dto.lotInvoiceMode,
                          paymentTermType: dto.paymentTermType,
                          paymentTermDays: dto.paymentTermDays,
                          paymentPlans: dto.paymentPlans,
                          lines: dto.lines.map((line) => ({
                              productId: line.productId,
                              issueWarehouseId: line.warehouseId,
                              receivingWarehouseAreaId: line.warehouseAreaId,
                              orderedActualQty: line.quantity,
                              unitPrice: line.unitPrice ?? 0,
                              discountBaseAmount: line.discountBaseAmount ?? line.discountAmount ?? 0,
                              discountAdjustmentAmount: line.discountAdjustmentAmount ?? 0,
                              supplySource: line.supplySource,
                              vehiclePlate: dto.vehiclePlate,
                              driverName: dto.driverName,
                          })),
                      } as never,
                      actor,
                  )

        if (dto.logId) {
            await this.prisma.salesQuickEntryLog.update({
                where: { id: dto.logId },
                data: { confirmed: dto as unknown as Prisma.InputJsonObject },
            })
        }
        // Trả về cả những cách viết vừa nhớ, để màn hình nói được đã học thêm gì.
        return { ...created, learnedAliases }
    }

    /**
     * Turns a manual correction into a permanent mapping. Only spellings the sale actually
     * resolved are learned, and an existing mapping is never overwritten.
     */
    private async learnFrom(dto: ConfirmQuickEntryDto, actor: ScopedActor) {
        const learned: string[] = []
        if (dto.customerRawText && dto.customerPartyId) {
            const alias = await this.aliases.learn(
                SalesAliasEntityType.PARTY,
                dto.customerPartyId,
                dto.customerRawText,
                actor,
            )
            if (alias) learned.push(alias.externalName)
        }
        for (const line of dto.lines ?? []) {
            if (line.productRawText && line.productId) {
                const alias = await this.aliases.learn(
                    SalesAliasEntityType.PRODUCT,
                    line.productId,
                    line.productRawText,
                    actor,
                )
                if (alias) learned.push(alias.externalName)
            }
            if (line.warehouseRawText && line.warehouseId) {
                const alias = await this.aliases.learn(
                    SalesAliasEntityType.WAREHOUSE,
                    line.warehouseId,
                    line.warehouseRawText,
                    actor,
                )
                if (alias) learned.push(alias.externalName)
            }
        }
        return learned
    }
}
