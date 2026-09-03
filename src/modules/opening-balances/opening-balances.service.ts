import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import * as ExcelJS from 'exceljs'
import {
    CostLayerEntryType,
    ExpectedSupplyStatus,
    InventoryPostingKind,
    OpenItemSourceType,
    OpeningBalanceBatchStatus,
    OpeningDebtBalanceType,
    OpeningDebtSide,
    OpeningInventoryLineKind,
    PayableEntryType,
    PayableOpenItemStatus,
    Prisma,
    ReceivableEntryType,
    ReceivableOpenItemStatus,
    ReceivableSettlementType,
    ReservationEventType,
    RestrictionEventType,
    RestrictionStatus,
    SettlementType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { InventoryCoreService } from 'src/modules/inventory/inventory-core.service'
import {
    CreateOpeningBalanceBatchDto,
    ListOpeningBalanceBatchesDto,
    OpeningDebtLineDto,
    OpeningInventoryLineDto,
    ReplaceOpeningBalanceLinesDto,
    UpdateOpeningBalanceBatchDto,
} from './dto/opening-balance.dto'

type ValidationIssue = { sheet: 'TON_KHO' | 'CONG_NO'; lineNo: number; field?: string; message: string }

@Injectable()
export class OpeningBalancesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly inventory: InventoryCoreService,
    ) {}

    private date(value?: string | Date | null) {
        return value ? new Date(value) : null
    }

    private decimal(value: Prisma.Decimal | number | string | null | undefined) {
        return new Prisma.Decimal(value ?? 0)
    }

    private async editableBatch(id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const batch = await tx.openingBalanceBatch.findUnique({ where: { id } })
        if (!batch) throw new NotFoundException({ code: 'OPENING_BALANCE_BATCH_NOT_FOUND' })
        if (
            batch.status !== OpeningBalanceBatchStatus.DRAFT &&
            batch.status !== OpeningBalanceBatchStatus.VALIDATED
        ) {
            throw new ConflictException({
                code: 'OPENING_BALANCE_BATCH_NOT_EDITABLE',
                message: 'Đợt số dư đã ghi sổ nên không thể sửa dữ liệu nguồn.',
            })
        }
        return batch
    }

    async list(query: ListOpeningBalanceBatchesDto) {
        const page = query.page ?? 1
        const pageSize = Math.min(query.pageSize ?? 20, 100)
        const keyword = query.keyword?.trim()
        const where: Prisma.OpeningBalanceBatchWhereInput = keyword
            ? { OR: [{ batchNo: { contains: keyword, mode: 'insensitive' } }, { sourceSystem: { contains: keyword, mode: 'insensitive' } }] }
            : {}
        const [rows, total] = await this.prisma.$transaction([
            this.prisma.openingBalanceBatch.findMany({
                where,
                orderBy: [{ cutoverDate: 'desc' }, { createdAt: 'desc' }],
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: { _count: { select: { inventoryLines: true, debtLines: true } } },
            }),
            this.prisma.openingBalanceBatch.count({ where }),
        ])
        const legalEntities = await this.prisma.legalEntity.findMany({
            where: { id: { in: [...new Set(rows.map((row) => row.legalEntityId))] } },
            include: { party: { select: { code: true, name: true } } },
        })
        const entityMap = new Map(legalEntities.map((item) => [item.id, item]))
        return { rows: rows.map((row) => ({ ...row, legalEntity: entityMap.get(row.legalEntityId) })), total, page, pageSize }
    }

    async detail(id: string) {
        const batch = await this.prisma.openingBalanceBatch.findUnique({
            where: { id },
            include: {
                inventoryLines: { orderBy: { lineNo: 'asc' } },
                debtLines: { orderBy: [{ side: 'asc' }, { lineNo: 'asc' }] },
            },
        })
        if (!batch) throw new NotFoundException({ code: 'OPENING_BALANCE_BATCH_NOT_FOUND' })
        return batch
    }

    async options() {
        const [legalEntities, warehouses, warehouseAreas, products, parties, employees] = await Promise.all([
            this.prisma.legalEntity.findMany({ include: { party: { select: { code: true, name: true } } }, orderBy: { code: 'asc' } }),
            this.prisma.warehouse.findMany({ where: { status: 'ACTIVE' }, include: { area: { select: { code: true, name: true } } }, orderBy: { name: 'asc' } }),
            this.prisma.warehouseArea.findMany({ where: { status: 'ACTIVE' }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
            this.prisma.product.findMany({ where: { status: 'ACTIVE' }, select: { id: true, code: true, name: true, uom: true }, orderBy: { code: 'asc' } }),
            this.prisma.party.findMany({ where: { deletedAt: null, masterStatus: 'ACTIVE' }, select: { id: true, code: true, name: true }, orderBy: { code: 'asc' } }),
            this.prisma.employee.findMany({ where: { status: 'active' }, select: { id: true, code: true, fullName: true }, orderBy: { code: 'asc' } }),
        ])
        return { legalEntities, warehouses, warehouseAreas, products, parties, employees }
    }

    async create(dto: CreateOpeningBalanceBatchDto, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('opening-balance-batch-no'))`
            const date = new Date(dto.cutoverDate)
            if (Number.isNaN(date.getTime())) throw new BadRequestException({ code: 'INVALID_CUTOVER_DATE' })
            const yy = String(date.getFullYear()).slice(-2)
            const prefix = `SDDK${yy}`
            const latest = await tx.openingBalanceBatch.findFirst({ where: { batchNo: { startsWith: prefix } }, orderBy: { batchNo: 'desc' }, select: { batchNo: true } })
            const sequence = Number(latest?.batchNo.slice(prefix.length) ?? 0) + 1
            return tx.openingBalanceBatch.create({
                data: {
                    batchNo: `${prefix}${String(sequence).padStart(4, '0')}`,
                    legalEntityId: dto.legalEntityId,
                    cutoverDate: date,
                    sourceSystem: dto.sourceSystem?.trim() || null,
                    note: dto.note?.trim() || null,
                    createdById: actorId ?? null,
                },
            })
        })
    }

    async update(id: string, dto: UpdateOpeningBalanceBatchDto) {
        await this.editableBatch(id)
        return this.prisma.openingBalanceBatch.update({
            where: { id },
            data: {
                legalEntityId: dto.legalEntityId,
                cutoverDate: dto.cutoverDate ? new Date(dto.cutoverDate) : undefined,
                sourceSystem: dto.sourceSystem === undefined ? undefined : dto.sourceSystem.trim() || null,
                note: dto.note === undefined ? undefined : dto.note.trim() || null,
                status: OpeningBalanceBatchStatus.DRAFT,
                validationSummary: Prisma.DbNull,
                version: { increment: 1 },
            },
        })
    }

    private inventoryData(batchId: string, line: OpeningInventoryLineDto, lineNo: number): Prisma.OpeningBalanceInventoryLineUncheckedCreateInput {
        return {
            batchId,
            lineNo,
            kind: line.kind,
            warehouseId: line.warehouseId ?? null,
            warehouseAreaId: line.warehouseAreaId ?? null,
            productId: line.productId,
            ownerPartyId: line.ownerPartyId,
            supplierPartyId: line.supplierPartyId ?? null,
            customerPartyId: line.customerPartyId ?? null,
            releaseCode: line.releaseCode ?? null,
            legacyLotNo: line.legacyLotNo?.trim() || null,
            legacyReference: line.legacyReference?.trim() || null,
            receivedAt: this.date(line.receivedAt),
            expectedAt: this.date(line.expectedAt),
            expiresAt: this.date(line.expiresAt),
            actualQty: line.actualQty,
            v15Qty: line.v15Qty ?? null,
            unitCost: line.unitCost ?? null,
            currency: (line.currency || 'VND').toUpperCase(),
            reason: line.reason?.trim() || null,
            note: line.note?.trim() || null,
        }
    }

    private debtData(batchId: string, line: OpeningDebtLineDto, lineNo: number): Prisma.OpeningBalanceDebtLineUncheckedCreateInput {
        return {
            batchId,
            lineNo,
            side: line.side,
            balanceType: line.balanceType ?? OpeningDebtBalanceType.DEBT,
            counterpartyPartyId: line.counterpartyPartyId,
            accountantEmployeeId: line.accountantEmployeeId ?? null,
            legacyDocumentNo: line.legacyDocumentNo?.trim() || null,
            legacyReference: line.legacyReference?.trim() || null,
            documentDate: this.date(line.documentDate),
            dueDate: this.date(line.dueDate),
            currency: (line.currency || 'VND').toUpperCase(),
            originalAmount: line.originalAmount,
            settledAmount: line.settledAmount ?? 0,
            outstandingAmount: line.outstandingAmount,
            note: line.note?.trim() || null,
        }
    }

    async replaceLines(id: string, dto: ReplaceOpeningBalanceLinesDto, sourceFileName?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            await tx.openingBalanceInventoryLine.deleteMany({ where: { batchId: id } })
            await tx.openingBalanceDebtLine.deleteMany({ where: { batchId: id } })
            if (dto.inventoryLines.length) {
                await tx.openingBalanceInventoryLine.createMany({ data: dto.inventoryLines.map((line, index) => this.inventoryData(id, line, line.lineNo ?? index + 1)) })
            }
            if (dto.debtLines.length) {
                const sideNo = new Map<OpeningDebtSide, number>()
                await tx.openingBalanceDebtLine.createMany({
                    data: dto.debtLines.map((line) => {
                        const next = line.lineNo ?? (sideNo.get(line.side) ?? 0) + 1
                        sideNo.set(line.side, next)
                        return this.debtData(id, line, next)
                    }),
                })
            }
            await tx.openingBalanceBatch.update({ where: { id }, data: { status: OpeningBalanceBatchStatus.DRAFT, validationSummary: Prisma.DbNull, sourceFileName: sourceFileName ?? undefined, version: { increment: 1 } } })
            return tx.openingBalanceBatch.findUnique({ where: { id }, include: { inventoryLines: { orderBy: { lineNo: 'asc' } }, debtLines: { orderBy: [{ side: 'asc' }, { lineNo: 'asc' }] } } })
        })
    }

    private async resetValidation(tx: Prisma.TransactionClient, batchId: string, sourceFileName?: string | null) {
        await tx.openingBalanceBatch.update({
            where: { id: batchId },
            data: {
                status: OpeningBalanceBatchStatus.DRAFT,
                validationSummary: Prisma.DbNull,
                validatedAt: null,
                validatedById: null,
                sourceFileName: sourceFileName ?? undefined,
                version: { increment: 1 },
            },
        })
    }

    async replaceInventoryLines(id: string, lines: OpeningInventoryLineDto[], sourceFileName?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            await tx.openingBalanceInventoryLine.deleteMany({ where: { batchId: id } })
            if (lines.length) {
                await tx.openingBalanceInventoryLine.createMany({
                    data: lines.map((line, index) => this.inventoryData(id, line, line.lineNo ?? index + 1)),
                })
            }
            await this.resetValidation(tx, id, sourceFileName)
            return tx.openingBalanceInventoryLine.findMany({ where: { batchId: id }, orderBy: { lineNo: 'asc' } })
        })
    }

    async replaceDebtLines(
        id: string,
        side: OpeningDebtSide,
        lines: OpeningDebtLineDto[],
        sourceFileName?: string | null,
    ) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            await tx.openingBalanceDebtLine.deleteMany({ where: { batchId: id, side } })
            if (lines.length) {
                await tx.openingBalanceDebtLine.createMany({
                    data: lines.map((line, index) => this.debtData(id, { ...line, side }, line.lineNo ?? index + 1)),
                })
            }
            await this.resetValidation(tx, id, sourceFileName)
            return tx.openingBalanceDebtLine.findMany({ where: { batchId: id, side }, orderBy: { lineNo: 'asc' } })
        })
    }

    async createInventoryLine(id: string, dto: OpeningInventoryLineDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const latest = await tx.openingBalanceInventoryLine.aggregate({ where: { batchId: id }, _max: { lineNo: true } })
            const row = await tx.openingBalanceInventoryLine.create({
                data: this.inventoryData(id, dto, (latest._max.lineNo ?? 0) + 1),
            })
            await this.resetValidation(tx, id)
            return row
        })
    }

    async updateInventoryLine(id: string, lineId: string, dto: OpeningInventoryLineDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const current = await tx.openingBalanceInventoryLine.findFirst({ where: { id: lineId, batchId: id } })
            if (!current) throw new NotFoundException({ code: 'OPENING_INVENTORY_LINE_NOT_FOUND' })
            const row = await tx.openingBalanceInventoryLine.update({
                where: { id: lineId },
                data: this.inventoryData(id, dto, current.lineNo),
            })
            await this.resetValidation(tx, id)
            return row
        })
    }

    async deleteInventoryLine(id: string, lineId: string) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const deleted = await tx.openingBalanceInventoryLine.deleteMany({ where: { id: lineId, batchId: id } })
            if (!deleted.count) throw new NotFoundException({ code: 'OPENING_INVENTORY_LINE_NOT_FOUND' })
            await this.resetValidation(tx, id)
            return { deleted: true }
        })
    }

    async createDebtLine(id: string, side: OpeningDebtSide, dto: OpeningDebtLineDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const latest = await tx.openingBalanceDebtLine.aggregate({ where: { batchId: id, side }, _max: { lineNo: true } })
            const row = await tx.openingBalanceDebtLine.create({
                data: this.debtData(id, { ...dto, side }, (latest._max.lineNo ?? 0) + 1),
            })
            await this.resetValidation(tx, id)
            return row
        })
    }

    async updateDebtLine(id: string, lineId: string, dto: OpeningDebtLineDto) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const current = await tx.openingBalanceDebtLine.findFirst({ where: { id: lineId, batchId: id } })
            if (!current) throw new NotFoundException({ code: 'OPENING_DEBT_LINE_NOT_FOUND' })
            const row = await tx.openingBalanceDebtLine.update({
                where: { id: lineId },
                data: this.debtData(id, { ...dto, side: current.side }, current.lineNo),
            })
            await this.resetValidation(tx, id)
            return row
        })
    }

    async deleteDebtLine(id: string, lineId: string) {
        return this.prisma.$transaction(async (tx) => {
            await this.editableBatch(id, tx)
            const deleted = await tx.openingBalanceDebtLine.deleteMany({ where: { id: lineId, batchId: id } })
            if (!deleted.count) throw new NotFoundException({ code: 'OPENING_DEBT_LINE_NOT_FOUND' })
            await this.resetValidation(tx, id)
            return { deleted: true }
        })
    }

    private async validateData(id: string, tx: Prisma.TransactionClient | PrismaService = this.prisma) {
        const batch = await tx.openingBalanceBatch.findUnique({ where: { id }, include: { inventoryLines: true, debtLines: true } })
        if (!batch) throw new NotFoundException({ code: 'OPENING_BALANCE_BATCH_NOT_FOUND' })
        const issues: ValidationIssue[] = []
        const onHandByKey = new Map<string, { qty: Prisma.Decimal; warehouseId: string; productId: string; ownerPartyId: string }>()
        const heldByKey = new Map<string, Prisma.Decimal>()
        if (!batch.inventoryLines.length && !batch.debtLines.length) issues.push({ sheet: 'TON_KHO', lineNo: 0, message: 'Đợt nhập chưa có dữ liệu.' })
        for (const line of batch.inventoryLines) {
            const add = (field: string, message: string) => issues.push({ sheet: 'TON_KHO', lineNo: line.lineNo, field, message })
            if (line.actualQty.lte(0)) add('actualQty', 'Số lượng phải lớn hơn 0.')
            if (line.kind === OpeningInventoryLineKind.EXPECTED) {
                if (!!line.warehouseId === !!line.warehouseAreaId) add('warehouse', 'Hàng dự kiến phải chọn đúng một kho đích danh hoặc khu vực kho.')
                if (!line.expectedAt) add('expectedAt', 'Hàng dự kiến phải có ngày dự kiến.')
                if (!line.supplierPartyId) add('supplierPartyId', 'Hàng dự kiến phải có nhà cung cấp.')
                continue
            }
            if (!line.warehouseId) add('warehouseId', 'Tồn thực tế phải có kho đích danh.')
            if (!line.legacyLotNo) add('legacyLotNo', 'Phải có mã lô cũ để đối chiếu và giữ/khóa đúng lô.')
            if (line.kind === OpeningInventoryLineKind.ON_HAND) {
                if (!line.supplierPartyId) add('supplierPartyId', 'Tồn thực tế phải có mã nhà cung cấp.')
                if (!line.releaseCode) add('releaseCode', 'Tồn thực tế phải xác định mã rút TP/NCC.')
                if (line.unitCost == null) add('unitCost', 'Tồn thực tế phải có giá vốn đầu kỳ (có thể bằng 0).')
                if (line.legacyLotNo && line.warehouseId) {
                    const key = `${line.legacyLotNo.trim().toUpperCase()}|${line.warehouseId}|${line.productId}|${line.ownerPartyId}`
                    if (onHandByKey.has(key)) add('legacyLotNo', 'Mã lô cũ bị trùng trong cùng kho/hàng/chủ sở hữu.')
                    else onHandByKey.set(key, { qty: line.actualQty, warehouseId: line.warehouseId, productId: line.productId, ownerPartyId: line.ownerPartyId })
                }
            } else {
                if (line.kind === OpeningInventoryLineKind.RESERVED && !line.customerPartyId) add('customerPartyId', 'Tồn giữ phải chỉ rõ khách hàng.')
                if (line.kind === OpeningInventoryLineKind.BLOCKED && !line.reason) add('reason', 'Tồn không được bán phải có lý do khóa.')
                if (line.legacyLotNo && line.warehouseId) {
                    const key = `${line.legacyLotNo.trim().toUpperCase()}|${line.warehouseId}|${line.productId}|${line.ownerPartyId}`
                    heldByKey.set(key, (heldByKey.get(key) ?? new Prisma.Decimal(0)).plus(line.actualQty))
                }
            }
        }
        for (const [key, held] of heldByKey) {
            const lot = onHandByKey.get(key)
            if (!lot) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'legacyLotNo', message: `Dòng giữ/khóa tham chiếu lô không có trong tồn đầu kỳ: ${key.split('|')[0]}.` })
            else if (held.gt(lot.qty)) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'actualQty', message: `Tổng giữ/khóa của lô ${key.split('|')[0]} vượt tồn thực tế.` })
        }
        for (const line of batch.debtLines) {
            const add = (field: string, message: string) => issues.push({ sheet: 'CONG_NO', lineNo: line.lineNo, field, message })
            if (line.originalAmount.lte(0)) add('originalAmount', 'Giá trị gốc phải lớn hơn 0.')
            if (line.outstandingAmount.lte(0)) add('outstandingAmount', 'Số còn lại phải lớn hơn 0.')
            if (!line.originalAmount.equals(line.settledAmount.plus(line.outstandingAmount))) add('outstandingAmount', 'Giá trị gốc phải bằng đã thanh toán cộng còn lại.')
        }
        const masterIds = {
            warehouseIds: [...new Set(batch.inventoryLines.map((l) => l.warehouseId).filter(Boolean) as string[])],
            areaIds: [...new Set(batch.inventoryLines.map((l) => l.warehouseAreaId).filter(Boolean) as string[])],
            productIds: [...new Set(batch.inventoryLines.map((l) => l.productId))],
            partyIds: [...new Set(batch.inventoryLines.flatMap((l) => [l.ownerPartyId, l.supplierPartyId, l.customerPartyId]).concat(batch.debtLines.map((l) => l.counterpartyPartyId)).filter(Boolean) as string[])],
        }
        const [warehouses, areas, products, parties, legalEntity] = await Promise.all([
            tx.warehouse.findMany({ where: { id: { in: masterIds.warehouseIds } }, select: { id: true, legalEntityId: true } }),
            tx.warehouseArea.count({ where: { id: { in: masterIds.areaIds } } }),
            tx.product.count({ where: { id: { in: masterIds.productIds } } }),
            tx.party.count({ where: { id: { in: masterIds.partyIds } } }),
            tx.legalEntity.findUnique({ where: { id: batch.legalEntityId }, select: { id: true } }),
        ])
        if (!legalEntity) issues.push({ sheet: 'CONG_NO', lineNo: 0, field: 'legalEntityId', message: 'Pháp nhân không tồn tại.' })
        if (warehouses.length !== masterIds.warehouseIds.length) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'warehouseId', message: 'Có mã kho không tồn tại.' })
        if (warehouses.some((w) => w.legalEntityId !== batch.legalEntityId)) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'warehouseId', message: 'Có kho không thuộc pháp nhân của đợt nhập.' })
        if (areas !== masterIds.areaIds.length) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'warehouseAreaId', message: 'Có khu vực kho không tồn tại.' })
        if (products !== masterIds.productIds.length) issues.push({ sheet: 'TON_KHO', lineNo: 0, field: 'productId', message: 'Có mặt hàng không tồn tại.' })
        if (parties !== masterIds.partyIds.length) issues.push({ sheet: 'CONG_NO', lineNo: 0, field: 'counterpartyPartyId', message: 'Có đối tác/chủ sở hữu không tồn tại.' })
        const summary = {
            valid: issues.length === 0,
            inventoryLineCount: batch.inventoryLines.length,
            receivableLineCount: batch.debtLines.filter((l) => l.side === OpeningDebtSide.RECEIVABLE).length,
            payableLineCount: batch.debtLines.filter((l) => l.side === OpeningDebtSide.PAYABLE).length,
            onHandQty: batch.inventoryLines.filter((l) => l.kind === OpeningInventoryLineKind.ON_HAND).reduce((sum, l) => sum.plus(l.actualQty), new Prisma.Decimal(0)).toString(),
            receivableAmount: batch.debtLines.filter((l) => l.side === OpeningDebtSide.RECEIVABLE).reduce((sum, l) => sum.plus(l.outstandingAmount), new Prisma.Decimal(0)).toString(),
            payableAmount: batch.debtLines.filter((l) => l.side === OpeningDebtSide.PAYABLE).reduce((sum, l) => sum.plus(l.outstandingAmount), new Prisma.Decimal(0)).toString(),
            issues,
        }
        return { batch, summary }
    }

    async validate(id: string, actorId?: string | null) {
        await this.editableBatch(id)
        const { summary } = await this.validateData(id)
        await this.prisma.openingBalanceBatch.update({
            where: { id },
            data: {
                status: summary.valid ? OpeningBalanceBatchStatus.VALIDATED : OpeningBalanceBatchStatus.DRAFT,
                validationSummary: summary as unknown as Prisma.InputJsonValue,
                validatedAt: summary.valid ? new Date() : null,
                validatedById: summary.valid ? actorId ?? null : null,
                version: { increment: 1 },
            },
        })
        return summary
    }

    async post(id: string, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opening-balance:${id}`}))`
            const { batch, summary } = await this.validateData(id, tx)
            if (batch.status === OpeningBalanceBatchStatus.POSTED) return this.detail(id)
            if (batch.status !== OpeningBalanceBatchStatus.VALIDATED || !summary.valid) throw new ConflictException({ code: 'OPENING_BALANCE_NOT_VALIDATED', message: 'Phải kiểm tra hợp lệ trước khi ghi sổ.' })
            const onHand = batch.inventoryLines.filter((line) => line.kind === OpeningInventoryLineKind.ON_HAND)
            const lotByKey = new Map<string, string>()
            const postingLines: Array<{ warehouseId: string; productId: string; ownerPartyId: string; inventoryLotId: string; actualQtyDelta: Prisma.Decimal; v15QtyDelta: Prisma.Decimal | null }> = []
            for (const line of onHand) {
                const lot = await tx.inventoryLot.create({ data: { lotNo: `OB-${batch.batchNo}-${String(line.lineNo).padStart(4, '0')}`, productId: line.productId, originOwnerPartyId: line.ownerPartyId, supplierPartyId: line.supplierPartyId, receivedActualQty: line.actualQty, receivedV15Qty: line.v15Qty, receivedAt: line.receivedAt ?? new Date(batch.cutoverDate), releaseCode: line.releaseCode, openingBalanceLineId: line.id } })
                await tx.inventoryCostLayer.create({ data: { inventoryLotId: lot.id, ownerPartyId: line.ownerPartyId, originalActualQty: line.actualQty, remainingActualQty: line.actualQty, remainingValue: line.actualQty.mul(line.unitCost ?? 0), currency: line.currency, isProvisional: false, openedAt: new Date(batch.cutoverDate), entries: { create: { type: CostLayerEntryType.OPENING_BALANCE, actualQtyDelta: line.actualQty, valueDelta: line.actualQty.mul(line.unitCost ?? 0), idempotencyKey: `opening-balance:${batch.id}:cost:${line.id}`, effectiveAt: new Date(batch.cutoverDate) } } } })
                await tx.openingBalanceInventoryLine.update({ where: { id: line.id }, data: { postedInventoryLotId: lot.id } })
                lotByKey.set(`${line.legacyLotNo!.trim().toUpperCase()}|${line.warehouseId}|${line.productId}|${line.ownerPartyId}`, lot.id)
                postingLines.push({ warehouseId: line.warehouseId!, productId: line.productId, ownerPartyId: line.ownerPartyId, inventoryLotId: lot.id, actualQtyDelta: line.actualQty, v15QtyDelta: line.v15Qty })
            }
            let postingId: string | null = null
            if (postingLines.length) {
                const posting = await this.inventory.post(tx, { postingNo: `SDDK-${batch.batchNo}`, kind: InventoryPostingKind.OPENING_BALANCE, idempotencyKey: `opening-balance:${batch.id}:inventory`, effectiveAt: new Date(batch.cutoverDate), postedById: actorId, source: { openingBalanceBatchId: batch.id }, lines: postingLines })
                postingId = posting.id
            }
            for (const line of batch.inventoryLines.filter((item) => item.kind === OpeningInventoryLineKind.RESERVED)) {
                const lotId = lotByKey.get(`${line.legacyLotNo!.trim().toUpperCase()}|${line.warehouseId}|${line.productId}|${line.ownerPartyId}`)!
                const reservation = await tx.inventoryReservation.create({ data: { reservationNo: `SDDK-GIU-${batch.batchNo}-${line.lineNo}`, legalEntityId: batch.legalEntityId, customerPartyId: line.customerPartyId, manualReference: line.legacyReference ?? batch.batchNo, expiresAt: line.expiresAt, note: line.note, lines: { create: { lineNo: 1, warehouseId: line.warehouseId!, productId: line.productId, ownerPartyId: line.ownerPartyId, inventoryLotId: lotId, requestedActualQty: line.actualQty, requestedV15Qty: line.v15Qty } } }, include: { lines: true } })
                await this.inventory.activateReservationLine(tx, { reservationLineId: reservation.lines[0].id, actualQty: line.actualQty, v15Qty: line.v15Qty, idempotencyKey: `opening-balance:${batch.id}:reserve:${line.id}`, occurredAt: new Date(batch.cutoverDate), actorId, reason: 'Số dư đầu kỳ' })
                await tx.openingBalanceInventoryLine.update({ where: { id: line.id }, data: { postedReservationId: reservation.id } })
            }
            for (const line of batch.inventoryLines.filter((item) => item.kind === OpeningInventoryLineKind.BLOCKED)) {
                const lotId = lotByKey.get(`${line.legacyLotNo!.trim().toUpperCase()}|${line.warehouseId}|${line.productId}|${line.ownerPartyId}`)!
                const block = await tx.inventoryBlock.create({ data: { blockNo: `SDDK-KHOA-${batch.batchNo}-${line.lineNo}`, warehouseId: line.warehouseId!, productId: line.productId, ownerPartyId: line.ownerPartyId, inventoryLotId: lotId, reasonCode: line.reason!, originalActualQty: line.actualQty, originalV15Qty: line.v15Qty, activeActualQty: 0, activeV15Qty: line.v15Qty == null ? null : 0, status: RestrictionStatus.ACTIVE } })
                await this.inventory.changeRestriction(tx, { kind: 'BLOCK', restrictionId: block.id, type: RestrictionEventType.ACTIVATE, actualQty: line.actualQty, v15Qty: line.v15Qty, idempotencyKey: `opening-balance:${batch.id}:block:${line.id}`, occurredAt: new Date(batch.cutoverDate), actorId, reason: line.reason })
                await tx.openingBalanceInventoryLine.update({ where: { id: line.id }, data: { postedBlockId: block.id } })
            }
            for (const line of batch.inventoryLines.filter((item) => item.kind === OpeningInventoryLineKind.EXPECTED)) {
                const expected = await tx.expectedSupply.create({ data: { expectedNo: `SDDK-DK-${batch.batchNo}-${line.lineNo}`, warehouseId: line.warehouseId, warehouseAreaId: line.warehouseAreaId, productId: line.productId, ownerPartyId: line.ownerPartyId, supplierPartyId: line.supplierPartyId, releaseCode: line.releaseCode, manualReference: line.legacyReference ?? batch.batchNo, expectedActualQty: line.actualQty, expectedV15Qty: line.v15Qty, expectedAt: line.expectedAt, status: ExpectedSupplyStatus.OPEN } })
                await tx.openingBalanceInventoryLine.update({ where: { id: line.id }, data: { postedExpectedSupplyId: expected.id } })
            }
            for (const line of batch.debtLines) {
                if (line.side === OpeningDebtSide.RECEIVABLE) {
                    const item = await tx.receivableOpenItem.create({ data: { legalEntityId: batch.legalEntityId, customerPartyId: line.counterpartyPartyId, currency: line.currency, originalAmount: line.outstandingAmount, outstandingAmount: line.outstandingAmount, dueDate: line.dueDate, note: line.note, legacyReference: line.legacyDocumentNo ?? line.legacyReference, sourceType: OpenItemSourceType.OPENING_BALANCE, settlementType: line.balanceType === OpeningDebtBalanceType.ADVANCE ? ReceivableSettlementType.CUSTOMER_ADVANCE : ReceivableSettlementType.RECEIVABLE, openingBalanceLineId: line.id, entries: { create: { type: ReceivableEntryType.OPEN, amountDelta: line.outstandingAmount, idempotencyKey: `opening-balance:${batch.id}:ar:${line.id}`, effectiveAt: new Date(batch.cutoverDate) } } } })
                    await tx.openingBalanceDebtLine.update({ where: { id: line.id }, data: { postedOpenItemId: item.id } })
                } else {
                    const item = await tx.payableOpenItem.create({ data: { legalEntityId: batch.legalEntityId, supplierPartyId: line.counterpartyPartyId, currency: line.currency, originalAmount: line.outstandingAmount, outstandingAmount: line.outstandingAmount, dueDate: line.dueDate, note: line.note, legacyReference: line.legacyDocumentNo ?? line.legacyReference, sourceType: OpenItemSourceType.OPENING_BALANCE, settlementType: line.balanceType === OpeningDebtBalanceType.ADVANCE ? SettlementType.ADVANCE : SettlementType.PAYABLE, openingBalanceLineId: line.id, entries: { create: { type: PayableEntryType.OPEN, amountDelta: line.outstandingAmount, idempotencyKey: `opening-balance:${batch.id}:ap:${line.id}`, effectiveAt: new Date(batch.cutoverDate) } } } })
                    await tx.openingBalanceDebtLine.update({ where: { id: line.id }, data: { postedOpenItemId: item.id } })
                }
            }
            await tx.openingBalanceBatch.update({ where: { id }, data: { status: OpeningBalanceBatchStatus.POSTED, postedInventoryPostingId: postingId, postedAt: new Date(), postedById: actorId ?? null, version: { increment: 1 } } })
            return tx.openingBalanceBatch.findUnique({ where: { id }, include: { inventoryLines: true, debtLines: true } })
        }, { timeout: 60_000 })
    }

    async reverse(id: string, actorId?: string | null) {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`opening-balance:${id}`}))`
            const batch = await tx.openingBalanceBatch.findUnique({ where: { id }, include: { inventoryLines: true, debtLines: true } })
            if (!batch) throw new NotFoundException({ code: 'OPENING_BALANCE_BATCH_NOT_FOUND' })
            if (batch.status === OpeningBalanceBatchStatus.REVERSED) return batch
            if (batch.status !== OpeningBalanceBatchStatus.POSTED) throw new ConflictException({ code: 'OPENING_BALANCE_NOT_POSTED' })
            for (const line of batch.debtLines) {
                if (!line.postedOpenItemId) continue
                const allocations = line.side === OpeningDebtSide.RECEIVABLE
                    ? await tx.receivableAllocation.count({ where: { openItemId: line.postedOpenItemId, status: 'ACTIVE' } })
                    : await tx.payableAllocation.count({ where: { openItemId: line.postedOpenItemId, status: 'ACTIVE' } })
                if (allocations) throw new ConflictException({ code: 'OPENING_DEBT_HAS_SETTLEMENT', message: 'Không thể đảo vì công nợ đầu kỳ đã được thanh toán/phân bổ.' })
            }
            for (const line of batch.inventoryLines.filter((l) => l.postedReservationId)) {
                const rows = await tx.inventoryReservationLine.findMany({ where: { reservationId: line.postedReservationId! } })
                for (const row of rows) if (row.activeActualQty.gt(0)) await this.inventory.releaseReservationLine(tx, { reservationLineId: row.id, actualQty: row.activeActualQty, v15Qty: row.activeV15Qty, idempotencyKey: `opening-balance:${id}:reverse-reserve:${row.id}`, occurredAt: new Date(), actorId, reason: 'Đảo số dư đầu kỳ' })
            }
            for (const line of batch.inventoryLines.filter((l) => l.postedBlockId)) {
                const block = await tx.inventoryBlock.findUnique({ where: { id: line.postedBlockId! } })
                if (block?.activeActualQty.gt(0)) await this.inventory.changeRestriction(tx, { kind: 'BLOCK', restrictionId: block.id, type: RestrictionEventType.CANCEL, actualQty: block.activeActualQty, v15Qty: block.activeV15Qty, idempotencyKey: `opening-balance:${id}:reverse-block:${block.id}`, occurredAt: new Date(), actorId, reason: 'Đảo số dư đầu kỳ' })
            }
            await tx.expectedSupply.updateMany({ where: { id: { in: batch.inventoryLines.map((l) => l.postedExpectedSupplyId).filter(Boolean) as string[] }, status: ExpectedSupplyStatus.OPEN }, data: { status: ExpectedSupplyStatus.CANCELLED, version: { increment: 1 } } })
            if (batch.postedInventoryPostingId) await this.inventory.reverse(tx, { postingId: batch.postedInventoryPostingId, postingNo: `DAO-${batch.batchNo}`, idempotencyKey: `opening-balance:${id}:inventory-reverse`, effectiveAt: new Date(), postedById: actorId })
            for (const line of batch.debtLines) {
                if (!line.postedOpenItemId) continue
                if (line.side === OpeningDebtSide.RECEIVABLE) {
                    await tx.receivableLedgerEntry.create({ data: { openItemId: line.postedOpenItemId, type: ReceivableEntryType.REVERSAL, amountDelta: line.outstandingAmount.negated(), idempotencyKey: `opening-balance:${id}:ar-reverse:${line.id}`, effectiveAt: new Date() } })
                    await tx.receivableOpenItem.update({ where: { id: line.postedOpenItemId }, data: { status: ReceivableOpenItemStatus.VOIDED, outstandingAmount: 0, version: { increment: 1 } } })
                } else {
                    await tx.payableLedgerEntry.create({ data: { openItemId: line.postedOpenItemId, type: PayableEntryType.REVERSAL, amountDelta: line.outstandingAmount.negated(), idempotencyKey: `opening-balance:${id}:ap-reverse:${line.id}`, effectiveAt: new Date() } })
                    await tx.payableOpenItem.update({ where: { id: line.postedOpenItemId }, data: { status: PayableOpenItemStatus.VOIDED, outstandingAmount: 0, version: { increment: 1 } } })
                }
            }
            await tx.inventoryCostLayer.updateMany({ where: { inventoryLotId: { in: batch.inventoryLines.map((l) => l.postedInventoryLotId).filter(Boolean) as string[] } }, data: { status: 'CLOSED', remainingActualQty: 0, remainingValue: 0, version: { increment: 1 } } })
            return tx.openingBalanceBatch.update({ where: { id }, data: { status: OpeningBalanceBatchStatus.REVERSED, reversedAt: new Date(), reversedById: actorId ?? null, version: { increment: 1 } } })
        }, { timeout: 60_000 })
    }

    async template(section?: string) {
        const normalizedSection = section?.trim().toUpperCase()
        if (normalizedSection && !['INVENTORY', 'RECEIVABLE', 'PAYABLE'].includes(normalizedSection)) {
            throw new BadRequestException({ code: 'INVALID_OPENING_BALANCE_SECTION', message: 'Loại dữ liệu đầu kỳ không hợp lệ.' })
        }
        const workbook = new ExcelJS.Workbook()
        workbook.creator = 'TPOIL ERP'
        const inv = workbook.addWorksheet('TON_KHO')
        inv.addRow(['Loại', 'Kho', 'Khu vực', 'Mã hàng', 'Chủ sở hữu', 'Nhà cung cấp', 'Mã rút', 'Mã lô cũ', 'Ngày nhập', 'Ngày dự kiến', 'Khách hàng', 'Số lượng', 'V15', 'Giá vốn', 'Tiền tệ', 'Hết hạn', 'Lý do', 'Tham chiếu', 'Ghi chú'])
        inv.addRow(['ON_HAND', 'NGHISON', '', 'E10III', 'TPOIL', 'ANHPHAT', 'TP', 'LOT-CU-001', '2026-08-24', '', '', 10000, '', 21000, 'VND', '', '', 'PKK-001', ''])
        inv.addRow(['RESERVED', 'NGHISON', '', 'E10III', 'TPOIL', '', '', 'LOT-CU-001', '', '', 'SONHAI', 1000, '', '', 'VND', '2026-08-31', '', 'DH-CU-001', ''])
        inv.addRow(['EXPECTED', '', 'HAIPHONG', 'DO05SII', 'TPOIL', 'ANHPHAT', 'NCC', '', '', '2026-08-30', '', 50000, '', 20500, 'VND', '', '', 'PO-CU-001', ''])
        const ar = workbook.addWorksheet('PHAI_THU')
        const debtHeaders = ['Đối tác', 'Loại số dư', 'Số chứng từ', 'Ngày chứng từ', 'Hạn thanh toán', 'Tiền tệ', 'Giá trị gốc', 'Đã thanh toán', 'Còn lại', 'Kế toán', 'Tham chiếu', 'Ghi chú']
        ar.addRow(debtHeaders); ar.addRow(['SONHAI', 'DEBT', 'HD-CU-001', '2026-07-20', '2026-08-20', 'VND', 100000000, 20000000, 80000000, '', '', ''])
        const ap = workbook.addWorksheet('PHAI_TRA')
        ap.addRow(debtHeaders); ap.addRow(['ANHPHAT', 'DEBT', 'HDM-CU-001', '2026-07-20', '2026-08-20', 'VND', 200000000, 50000000, 150000000, '', '', ''])
        if (normalizedSection === 'INVENTORY') {
            workbook.removeWorksheet(ar.id)
            workbook.removeWorksheet(ap.id)
        } else if (normalizedSection === 'RECEIVABLE') {
            workbook.removeWorksheet(inv.id)
            workbook.removeWorksheet(ap.id)
        } else if (normalizedSection === 'PAYABLE') {
            workbook.removeWorksheet(inv.id)
            workbook.removeWorksheet(ar.id)
        }
        for (const sheet of workbook.worksheets) {
            sheet.views = [{ state: 'frozen', ySplit: 1 }]
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
            sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1677FF' } }
            sheet.columns.forEach((column) => { column.width = 18 })
            sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columnCount } }
        }
        return workbook.xlsx.writeBuffer()
    }

    private cell(row: ExcelJS.Row, index: number) {
        const value = row.getCell(index).value
        if (value == null) return ''
        if (value instanceof Date) return value.toISOString().slice(0, 10)
        if (typeof value === 'object' && 'text' in value) return String((value as any).text).trim()
        return String(value).trim()
    }

    async import(id: string, file: Express.Multer.File, section?: string) {
        if (!file?.buffer) throw new BadRequestException({ code: 'OPENING_BALANCE_FILE_REQUIRED' })
        const normalizedSection = section?.trim().toUpperCase()
        if (normalizedSection && !['INVENTORY', 'RECEIVABLE', 'PAYABLE'].includes(normalizedSection)) {
            throw new BadRequestException({ code: 'INVALID_OPENING_BALANCE_SECTION', message: 'Loại dữ liệu đầu kỳ không hợp lệ.' })
        }
        await this.editableBatch(id)
        const workbook = new ExcelJS.Workbook()
        await workbook.xlsx.load(file.buffer as any)
        const expectedSheet = normalizedSection === 'INVENTORY'
            ? 'TON_KHO'
            : normalizedSection === 'RECEIVABLE'
                ? 'PHAI_THU'
                : normalizedSection === 'PAYABLE'
                    ? 'PHAI_TRA'
                    : undefined
        if (expectedSheet && !workbook.getWorksheet(expectedSheet)) {
            throw new BadRequestException({ code: 'OPENING_BALANCE_SHEET_REQUIRED', message: `File phải có sheet ${expectedSheet}.` })
        }
        const opts = await this.options()
        const maps = {
            warehouse: new Map(opts.warehouses.map((v) => [v.code.toUpperCase(), v.id])),
            area: new Map(opts.warehouseAreas.map((v) => [v.code.toUpperCase(), v.id])),
            product: new Map(opts.products.map((v) => [v.code.toUpperCase(), v.id])),
            party: new Map(opts.parties.map((v) => [v.code.toUpperCase(), v.id])),
            employee: new Map(opts.employees.map((v) => [v.code.toUpperCase(), v.id])),
        }
        const lookup = (map: Map<string, string>, code: string, sheet: string, row: number, required = false) => {
            if (!code) { if (required) throw new BadRequestException({ code: 'IMPORT_CODE_REQUIRED', message: `${sheet} dòng ${row}: thiếu mã bắt buộc.` }); return undefined }
            const idValue = map.get(code.toUpperCase())
            if (!idValue) throw new BadRequestException({ code: 'IMPORT_CODE_NOT_FOUND', message: `${sheet} dòng ${row}: không tìm thấy mã ${code}.` })
            return idValue
        }
        const inventoryLines: OpeningInventoryLineDto[] = []
        const inv = !normalizedSection || normalizedSection === 'INVENTORY'
            ? workbook.getWorksheet('TON_KHO')
            : undefined
        if (inv) inv.eachRow((row, rowNo) => {
            if (rowNo === 1 || !this.cell(row, 1)) return
            const kind = this.cell(row, 1).toUpperCase() as OpeningInventoryLineKind
            if (!Object.values(OpeningInventoryLineKind).includes(kind)) throw new BadRequestException({ code: 'INVALID_INVENTORY_KIND', message: `TON_KHO dòng ${rowNo}: Loại không hợp lệ.` })
            inventoryLines.push({ lineNo: rowNo - 1, kind, warehouseId: lookup(maps.warehouse, this.cell(row, 2), 'TON_KHO', rowNo), warehouseAreaId: lookup(maps.area, this.cell(row, 3), 'TON_KHO', rowNo), productId: lookup(maps.product, this.cell(row, 4), 'TON_KHO', rowNo, true)!, ownerPartyId: lookup(maps.party, this.cell(row, 5), 'TON_KHO', rowNo, true)!, supplierPartyId: lookup(maps.party, this.cell(row, 6), 'TON_KHO', rowNo), releaseCode: (this.cell(row, 7).toUpperCase() || undefined) as any, legacyLotNo: this.cell(row, 8) || undefined, receivedAt: this.cell(row, 9) || undefined, expectedAt: this.cell(row, 10) || undefined, customerPartyId: lookup(maps.party, this.cell(row, 11), 'TON_KHO', rowNo), actualQty: Number(this.cell(row, 12)), v15Qty: this.cell(row, 13) ? Number(this.cell(row, 13)) : undefined, unitCost: this.cell(row, 14) ? Number(this.cell(row, 14)) : undefined, currency: this.cell(row, 15) || 'VND', expiresAt: this.cell(row, 16) || undefined, reason: this.cell(row, 17) || undefined, legacyReference: this.cell(row, 18) || undefined, note: this.cell(row, 19) || undefined })
        })
        const debtLines: OpeningDebtLineDto[] = []
        for (const [sheetName, side] of [['PHAI_THU', OpeningDebtSide.RECEIVABLE], ['PHAI_TRA', OpeningDebtSide.PAYABLE]] as const) {
            if (normalizedSection === 'RECEIVABLE' && side !== OpeningDebtSide.RECEIVABLE) continue
            if (normalizedSection === 'PAYABLE' && side !== OpeningDebtSide.PAYABLE) continue
            if (normalizedSection === 'INVENTORY') continue
            const sheet = workbook.getWorksheet(sheetName)
            if (!sheet) continue
            sheet.eachRow((row, rowNo) => {
                if (rowNo === 1 || !this.cell(row, 1)) return
                debtLines.push({ lineNo: rowNo - 1, side, counterpartyPartyId: lookup(maps.party, this.cell(row, 1), sheetName, rowNo, true)!, balanceType: (this.cell(row, 2).toUpperCase() || 'DEBT') as OpeningDebtBalanceType, legacyDocumentNo: this.cell(row, 3) || undefined, documentDate: this.cell(row, 4) || undefined, dueDate: this.cell(row, 5) || undefined, currency: this.cell(row, 6) || 'VND', originalAmount: Number(this.cell(row, 7)), settledAmount: Number(this.cell(row, 8) || 0), outstandingAmount: Number(this.cell(row, 9)), accountantEmployeeId: lookup(maps.employee, this.cell(row, 10), sheetName, rowNo), legacyReference: this.cell(row, 11) || undefined, note: this.cell(row, 12) || undefined })
            })
        }
        if (normalizedSection === 'INVENTORY') return this.replaceInventoryLines(id, inventoryLines, file.originalname)
        if (normalizedSection === 'RECEIVABLE') {
            return this.replaceDebtLines(id, OpeningDebtSide.RECEIVABLE, debtLines.filter((line) => line.side === OpeningDebtSide.RECEIVABLE), file.originalname)
        }
        if (normalizedSection === 'PAYABLE') {
            return this.replaceDebtLines(id, OpeningDebtSide.PAYABLE, debtLines.filter((line) => line.side === OpeningDebtSide.PAYABLE), file.originalname)
        }
        return this.replaceLines(id, { inventoryLines, debtLines }, file.originalname)
    }
}
