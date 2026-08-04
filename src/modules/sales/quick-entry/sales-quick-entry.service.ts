import { BadRequestException, Injectable } from '@nestjs/common'
import { Prisma, SalesAliasEntityType, SalesOrderKind } from '@prisma/client'
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
            entityName: null,
            confidence: 0,
            matchedBy: null,
            candidates: [],
            needsAttention: true,
        }
    }

    private async resolve(entityType: SalesAliasEntityType, rawText: string | null): Promise<ResolvedField> {
        if (!rawText?.trim()) return this.empty(rawText)
        const match = await this.aliases.match(entityType, rawText)
        if (match.ok) {
            const name = await this.entityName(entityType, match.entityId)
            return {
                rawText,
                entityId: match.entityId,
                entityName: name,
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
            entityName: null,
            confidence: 0,
            matchedBy: match.reason,
            candidates: match.candidates,
            needsAttention: true,
        }
    }

    private async entityName(entityType: SalesAliasEntityType, id: string) {
        if (entityType === SalesAliasEntityType.PARTY) {
            return (await this.prisma.party.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
        }
        if (entityType === SalesAliasEntityType.WAREHOUSE) {
            return (await this.prisma.warehouse.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
        }
        return (await this.prisma.product.findUnique({ where: { id }, select: { name: true } }))?.name ?? null
    }

    private orderKindOf(kind: ParsedOrderKind | null) {
        if (kind === 'SINGLE') return SalesOrderKind.SINGLE
        if (kind === 'LOT') return SalesOrderKind.LOT
        return null
    }

    /** Reads the paste and proposes a draft. Writes nothing except the log. */
    async parse(dto: ParseQuickEntryDto, actor: ScopedActor) {
        const rawText = dto.text?.trim()
        if (!rawText) throw new BadRequestException('QUICK_ENTRY_TEXT_EMPTY')

        let parsed = parseQuickEntry(rawText)
        let usedAi = false

        // Regex first; AI only fills genuine gaps (spec v1.2 nguyên tắc 12).
        const incomplete =
            !parsed.customerText ||
            !parsed.lines.length ||
            parsed.lines.some((line) => !line.productText || line.quantity == null)
        if (incomplete && this.deepSeek.isEnabled) {
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

        const orderDate = this.suggestOrderDate()
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

        if (dto.learnAliases !== false) {
            await this.learnFrom(dto, actor)
        }

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
                              warehouseId: line.warehouseId,
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
                          lines: dto.lines.map((line) => ({
                              productId: line.productId,
                              issueWarehouseId: line.warehouseId,
                              orderedActualQty: line.quantity,
                              unitPrice: line.unitPrice ?? 0,
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
        return created
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
