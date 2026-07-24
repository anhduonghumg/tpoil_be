import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    CustomerStatus,
    OperationalCostSourceType,
    OperationalPartyRole,
    OperationRegistrationStatus,
    PartyRoleType,
    Prisma,
    ShipCharterContractStatus,
    ShipCharterOrderSourceType,
    ShipCharterOrderStatus,
    ShipFreightRateSourceType,
    ShipFreightRateStatus,
    TermTransportMode,
    TermLogisticsCostStatus,
    TermLogisticsCostType,
    VesselDocument,
    VesselDocumentType,
} from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import {
    CreateOperationalRoleDto,
    CreateShipOwnerDto,
    CreateVesselDocumentDto,
    CreateAppendixFromOrderDto,
    CreateCharterOrderFromTermDto,
    PageQueryDto,
    ShipOwnerListQueryDto,
    ShipFreightRateLookupDto,
    UpsertCharterInsuranceDto,
    UpsertCharterInspectionDto,
    UpsertShipCharterAppendixDto,
    UpsertShipCharterContractDto,
    UpsertShipCharterOrderDto,
    UpsertShipFreightRateDto,
    UpsertShippingAgentDto,
    UpsertVesselDto,
    UpdateShipOwnerDto,
    UpdateVesselDocumentDto,
    UpdateVesselDto,
    VesselDocumentListQueryDto,
    VesselListQueryDto,
} from './dto/operations.dto'
import { CustomersService } from 'src/modules/customers/customers.service'

const SHIP_OWNER_ROLES = [PartyRoleType.SHIP_OWNER, PartyRoleType.SEA_CARRIER] as const

const REQUIRED_VESSEL_DOCUMENTS = [
    { documentType: VesselDocumentType.VESSEL_REGISTRATION, label: 'Giấy chứng nhận đăng ký tàu' },
    { documentType: VesselDocumentType.VESSEL_INSPECTION, label: 'Giấy chứng nhận đăng kiểm' },
    { documentType: VesselDocumentType.FIRE_SAFETY_CERTIFICATE, label: 'Giấy chứng nhận đủ điều kiện PCCC' },
    { documentType: VesselDocumentType.TANK_CALIBRATION_BAREM, label: 'Barem hợp lệ của phương tiện vận chuyển' },
    { documentType: VesselDocumentType.H_AND_M_INSURANCE, label: 'Bảo hiểm tàu H&M' },
    { documentType: VesselDocumentType.P_AND_I_INSURANCE, label: 'Bảo hiểm trách nhiệm dân sự P&I' },
] as const

type VesselDocumentCheckStatus = 'MISSING' | 'EXPIRED' | 'EXPIRING_SOON' | 'VALID'

@Injectable()
export class ShipCharterService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly customers: CustomersService,
    ) {}

    private page(q: PageQueryDto) {
        const page = Math.max(Number(q.page ?? 1) || 1, 1)
        const pageSize = Math.min(Math.max(Number(q.pageSize ?? 30) || 30, 1), 200)
        return { skip: (page - 1) * pageSize, take: pageSize }
    }

    async listPartners(role?: string, keyword?: string) {
        const items = await this.prisma.partyRole.findMany({
            where: {
                validTo: null,
                ...(role ? { role: role === OperationalPartyRole.STORAGE_LESSOR ? PartyRoleType.STORAGE_LESSOR : (role as PartyRoleType) } : {}),
                ...(keyword
                    ? {
                          party: {
                              OR: [
                                  { name: { contains: keyword, mode: 'insensitive' } },
                                  { code: { contains: keyword, mode: 'insensitive' } },
                              ],
                          },
                      }
                    : {}),
            },
            include: { party: true },
            orderBy: { party: { name: 'asc' } },
        })
        return items.map((item) => ({ ...item, customerId: item.partyId, customer: item.party, isActive: true }))
    }

    savePartnerRole(dto: CreateOperationalRoleDto) {
        const role = dto.role === OperationalPartyRole.STORAGE_LESSOR ? PartyRoleType.STORAGE_LESSOR : (dto.role as unknown as PartyRoleType)
        return this.prisma.$transaction(async (tx) => {
            const current = await tx.partyRole.findFirst({
                where: { partyId: dto.customerId, role, validTo: null },
                include: { party: true },
            })
            if (dto.isActive === false) {
                if (!current) return null
                const updated = await tx.partyRole.update({
                    where: { id: current.id },
                    data: { validTo: new Date(), note: dto.note },
                    include: { party: true },
                })
                return { ...updated, customerId: updated.partyId, customer: updated.party, isActive: false }
            }
            if (current) return { ...current, customerId: current.partyId, customer: current.party, isActive: true }
            const created = await tx.partyRole.create({
                data: { partyId: dto.customerId, role, note: dto.note },
                include: { party: true },
            })
            return { ...created, customerId: created.partyId, customer: created.party, isActive: true }
        })
    }

    async listShipOwners(q: ShipOwnerListQueryDto) {
        const roleFilter = q.role ? [q.role] : [...SHIP_OWNER_ROLES]
        const where: Prisma.PartyWhereInput = {
            deletedAt: null,
            ...(q.isActive === true
                ? { status: CustomerStatus.Active }
                : q.isActive === false
                  ? { status: { not: CustomerStatus.Active } }
                  : {}),
            roles: {
                some: { role: { in: roleFilter as PartyRoleType[] }, validTo: null },
            },
            ...(q.keyword
                ? {
                      OR: [
                          { code: { contains: q.keyword, mode: 'insensitive' } },
                          { name: { contains: q.keyword, mode: 'insensitive' } },
                          { taxCode: { contains: q.keyword, mode: 'insensitive' } },
                          { contactPhone: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.party.findMany({
                where,
                ...this.page(q),
                include: {
                    roles: { where: { validTo: null }, select: { role: true } },
                    _count: { select: { ownedVessels: { where: { isActive: true } } } },
                },
                orderBy: { name: 'asc' },
            }),
            this.prisma.party.count({ where }),
        ])
        return {
            items: items.map((item) => ({
                ...item,
                partnerRoles: item.roles.map((role) => role.role),
                activeVesselCount: item._count.ownedVessels,
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async shipOwnerSelect(keyword?: string) {
        return this.prisma.party.findMany({
            where: {
                deletedAt: null,
                status: CustomerStatus.Active,
                roles: { some: { role: { in: [...SHIP_OWNER_ROLES] }, validTo: null } },
                ...(keyword
                    ? {
                          OR: [
                              { code: { contains: keyword, mode: 'insensitive' } },
                              { name: { contains: keyword, mode: 'insensitive' } },
                          ],
                      }
                    : {}),
            },
            select: {
                id: true,
                code: true,
                name: true,
                roles: { where: { role: { in: [...SHIP_OWNER_ROLES] }, validTo: null }, select: { role: true } },
            },
            orderBy: { name: 'asc' },
            take: 200,
        })
    }

    async shipOwner(customerId: string) {
        const owner = await this.prisma.party.findFirst({
            where: {
                id: customerId,
                deletedAt: null,
                roles: { some: { role: { in: [...SHIP_OWNER_ROLES] }, validTo: null } },
            },
            include: {
                roles: { where: { validTo: null }, select: { role: true } },
                ownedVessels: { orderBy: { name: 'asc' } },
                shipCharterContracts: {
                    include: { appendices: { include: { vessel: true }, orderBy: { appendixDate: 'desc' } } },
                    orderBy: { createdAt: 'desc' },
                },
                shipCharterOrders: { include: { vessel: true }, orderBy: { createdAt: 'desc' }, take: 100 },
                shipFreightRates: { include: { vessel: true }, orderBy: { effectiveFrom: 'desc' }, take: 100 },
            },
        })
        if (!owner) throw new NotFoundException('Không tìm thấy chủ tàu hoặc đơn vị vận tải biển.')
        return { ...owner, partnerRoles: owner.roles.map((role) => role.role) }
    }

    createShipOwner(dto: CreateShipOwnerDto) {
        return this.customers.create(dto)
    }

    async updateShipOwner(customerId: string, dto: UpdateShipOwnerDto) {
        if (dto.partnerRoles === undefined) return this.customers.update(customerId, dto)

        const current = await this.customers.detail(customerId)
        const otherRoles = current.partnerRoles.filter((role) => !SHIP_OWNER_ROLES.includes(role as (typeof SHIP_OWNER_ROLES)[number]))
        return this.customers.update(customerId, {
            ...dto,
            partnerRoles: [...otherRoles, ...dto.partnerRoles],
        })
    }

    private async assertShipOwner(customerId: string) {
        const owner = await this.prisma.party.findFirst({
            where: {
                id: customerId,
                deletedAt: null,
                status: CustomerStatus.Active,
                roles: { some: { role: { in: [...SHIP_OWNER_ROLES] }, validTo: null } },
            },
            select: { id: true },
        })
        if (!owner) {
            throw new BadRequestException('Chủ tàu phải là đối tác đang hoạt động có vai trò Chủ tàu hoặc Đơn vị vận tải biển.')
        }
    }

    private async assertPartnerRole(customerId: string, role: OperationalPartyRole, label: string) {
        const customer = await this.prisma.party.findFirst({
            where: {
                id: customerId,
                deletedAt: null,
                status: CustomerStatus.Active,
                roles: {
                    some: {
                        role:
                            role === OperationalPartyRole.STORAGE_LESSOR
                                ? PartyRoleType.STORAGE_LESSOR
                                : (role as unknown as PartyRoleType),
                        validTo: null,
                    },
                },
            },
            select: { id: true },
        })
        if (!customer) throw new BadRequestException(`${label} phải là đối tác đang hoạt động có đúng vai trò.`)
    }

    private generatedNo(prefix: string) {
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '')
        return `${prefix}-${date}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    }

    private rethrowVesselConstraint(error: unknown): never {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            const target = Array.isArray(error.meta?.target) ? error.meta.target.join(',') : String(error.meta?.target ?? '')
            if (target.includes('imoNo')) throw new BadRequestException('Số IMO đã tồn tại.')
            if (target.includes('ownerCustomerId') || target.includes('name')) {
                throw new BadRequestException('Tên tàu đã tồn tại trong danh mục của chủ tàu này.')
            }
            throw new BadRequestException('Thông tin tàu bị trùng.')
        }
        throw error
    }

    private latestDocument(documents: VesselDocument[], documentType: VesselDocumentType) {
        return documents
            .filter((document) => document.documentType === documentType)
            .sort((left, right) => {
                const leftTime = (left.issuedDate ?? left.createdAt).getTime()
                const rightTime = (right.issuedDate ?? right.createdAt).getTime()
                return rightTime - leftTime || right.createdAt.getTime() - left.createdAt.getTime()
            })[0]
    }

    private buildDocumentCheck(vesselId: string, documents: VesselDocument[], documentFileUrl?: string | null) {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const expiringSoonAt = new Date(today)
        expiringSoonAt.setDate(expiringSoonAt.getDate() + 30)

        const items = REQUIRED_VESSEL_DOCUMENTS.map((requirement) => {
            const latestDocument = this.latestDocument(documents, requirement.documentType)
            let status: VesselDocumentCheckStatus = 'VALID'
            if (!documentFileUrl?.trim() || !latestDocument) status = 'MISSING'
            else if (requirement.documentType !== VesselDocumentType.VESSEL_REGISTRATION && latestDocument.expiredDate && latestDocument.expiredDate < today) status = 'EXPIRED'
            else if (requirement.documentType !== VesselDocumentType.VESSEL_REGISTRATION && latestDocument.expiredDate && latestDocument.expiredDate <= expiringSoonAt) status = 'EXPIRING_SOON'

            return { ...requirement, required: true, status, latestDocument: latestDocument ?? null }
        })
        const missingCount = items.filter((item) => item.status === 'MISSING').length
        const expiredCount = items.filter((item) => item.status === 'EXPIRED').length
        const expiringSoonCount = items.filter((item) => item.status === 'EXPIRING_SOON').length
        const isReady = missingCount === 0 && expiredCount === 0
        const readinessStatus = !isReady ? 'NOT_READY' : expiringSoonCount > 0 ? 'WARNING' : 'READY'

        return { vesselId, readinessStatus, isReady, missingCount, expiredCount, expiringSoonCount, items }
    }

    async listVessels(q: VesselListQueryDto) {
        const where: Prisma.VesselWhereInput = {
            ...(q.ownerCustomerId ? { ownerCustomerId: q.ownerCustomerId } : {}),
            ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { name: { contains: q.keyword, mode: 'insensitive' } },
                          { imoNo: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vessel.findMany({
                where,
                ...this.page(q),
                include: { owner: { select: { id: true, code: true, name: true } }, documents: true },
                orderBy: { name: 'asc' },
            }),
            this.prisma.vessel.count({ where }),
        ])
        return {
            items: items.map(({ documents, ...item }) => ({
                ...item,
                documentCheck: this.buildDocumentCheck(item.id, documents, item.documentFileUrl),
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async vesselSelect(q: VesselListQueryDto) {
        const where: Prisma.VesselWhereInput = {
            isActive: q.isActive ?? true,
            ...(q.ownerCustomerId ? { ownerCustomerId: q.ownerCustomerId } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { name: { contains: q.keyword, mode: 'insensitive' } },
                          { imoNo: { contains: q.keyword, mode: 'insensitive' } },
                      ],
                  }
                : {}),
        }
        return this.prisma.vessel.findMany({
            where,
            select: { id: true, name: true, imoNo: true, ownerCustomerId: true },
            orderBy: { name: 'asc' },
            take: 200,
        })
    }

    async vessel(id: string) {
        const vessel = await this.prisma.vessel.findUnique({
            where: { id },
            include: {
                owner: true,
                documents: true,
                charterOrders: {
                    include: { contract: true, appendix: true },
                    orderBy: { createdAt: 'desc' },
                    take: 100,
                },
            },
        })
        if (!vessel) throw new NotFoundException('Không tìm thấy tàu.')
        const { documents, ...data } = vessel
        return { ...data, documents, documentCheck: this.buildDocumentCheck(id, documents, vessel.documentFileUrl) }
    }

    async createVessel(dto: UpsertVesselDto) {
        await this.assertShipOwner(dto.ownerCustomerId)
        const data: Prisma.VesselUncheckedCreateInput = {
            name: dto.name.trim(),
            ownerCustomerId: dto.ownerCustomerId,
            imoNo: dto.imoNo?.trim() || null,
            mmsiNo: dto.mmsiNo?.trim() || null,
            nationality: dto.nationality?.trim() || null,
            deadweightTonnage: dto.deadweightTonnage,
            capacity: dto.capacity,
            length: dto.length,
            width: dto.width,
            draft: dto.draft,
            allowedCargoTypes: dto.allowedCargoTypes as Prisma.InputJsonValue,
            documentFileUrl: dto.documentFileUrl?.trim() || null,
            isActive: dto.isActive ?? true,
            note: dto.note?.trim() || null,
        }
        try {
            return await this.prisma.vessel.create({ data, include: { owner: true } })
        } catch (error) {
            this.rethrowVesselConstraint(error)
        }
    }

    async updateVessel(id: string, dto: UpdateVesselDto) {
        const current = await this.prisma.vessel.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('Không tìm thấy tàu.')
        const ownerCustomerId = dto.ownerCustomerId ?? current.ownerCustomerId
        await this.assertShipOwner(ownerCustomerId)

        const data: Prisma.VesselUncheckedUpdateInput = {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.ownerCustomerId !== undefined ? { ownerCustomerId } : {}),
            ...(dto.imoNo !== undefined ? { imoNo: dto.imoNo.trim() || null } : {}),
            ...(dto.mmsiNo !== undefined ? { mmsiNo: dto.mmsiNo.trim() || null } : {}),
            ...(dto.nationality !== undefined ? { nationality: dto.nationality.trim() || null } : {}),
            ...(dto.deadweightTonnage !== undefined ? { deadweightTonnage: dto.deadweightTonnage } : {}),
            ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
            ...(dto.length !== undefined ? { length: dto.length } : {}),
            ...(dto.width !== undefined ? { width: dto.width } : {}),
            ...(dto.draft !== undefined ? { draft: dto.draft } : {}),
            ...(dto.allowedCargoTypes !== undefined ? { allowedCargoTypes: dto.allowedCargoTypes as Prisma.InputJsonValue } : {}),
            ...(dto.documentFileUrl !== undefined ? { documentFileUrl: dto.documentFileUrl.trim() || null } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
            ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
        }
        try {
            return await this.prisma.vessel.update({ where: { id }, data, include: { owner: true } })
        } catch (error) {
            this.rethrowVesselConstraint(error)
        }
    }

    async listVesselDocuments(vesselId: string, q: VesselDocumentListQueryDto) {
        const vessel = await this.prisma.vessel.findUnique({ where: { id: vesselId }, select: { id: true } })
        if (!vessel) throw new NotFoundException('Không tìm thấy tàu.')
        const where: Prisma.VesselDocumentWhereInput = {
            vesselId,
            ...(q.documentType ? { documentType: q.documentType } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.vesselDocument.findMany({
                where,
                ...this.page(q),
                orderBy: [{ issuedDate: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
            }),
            this.prisma.vesselDocument.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    private validateDocumentDates(issuedDate?: Date | null, expiredDate?: Date | null) {
        if (issuedDate && expiredDate && issuedDate > expiredDate) {
            throw new BadRequestException('Ngày cấp hồ sơ không được sau ngày hết hạn.')
        }
    }

    async createVesselDocument(vesselId: string, dto: CreateVesselDocumentDto) {
        const vessel = await this.prisma.vessel.findUnique({ where: { id: vesselId }, select: { id: true } })
        if (!vessel) throw new NotFoundException('Không tìm thấy tàu.')
        const issuedDate = dto.issuedDate ? new Date(dto.issuedDate) : null
        const expiredDate = dto.expiredDate ? new Date(dto.expiredDate) : null
        this.validateDocumentDates(issuedDate, expiredDate)
        return this.prisma.vesselDocument.create({
            data: {
                vesselId,
                documentType: dto.documentType,
                documentNo: dto.documentNo?.trim() || null,
                issuedDate,
                expiredDate,
                fileUrl: dto.fileUrl?.trim() || null,
                note: dto.note?.trim() || null,
            },
        })
    }

    async updateVesselDocument(id: string, dto: UpdateVesselDocumentDto) {
        const current = await this.prisma.vesselDocument.findUnique({ where: { id } })
        if (!current) throw new NotFoundException('Không tìm thấy hồ sơ tàu.')
        const issuedDate = dto.issuedDate === undefined ? current.issuedDate : dto.issuedDate ? new Date(dto.issuedDate) : null
        const expiredDate = dto.expiredDate === undefined ? current.expiredDate : dto.expiredDate ? new Date(dto.expiredDate) : null
        this.validateDocumentDates(issuedDate, expiredDate)
        return this.prisma.vesselDocument.update({
            where: { id },
            data: {
                ...(dto.documentType !== undefined ? { documentType: dto.documentType } : {}),
                ...(dto.documentNo !== undefined ? { documentNo: dto.documentNo.trim() || null } : {}),
                ...(dto.issuedDate !== undefined ? { issuedDate } : {}),
                ...(dto.expiredDate !== undefined ? { expiredDate } : {}),
                ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl.trim() || null } : {}),
                ...(dto.note !== undefined ? { note: dto.note.trim() || null } : {}),
            },
        })
    }

    async vesselDocumentCheck(vesselId: string) {
        const vessel = await this.prisma.vessel.findUnique({
            where: { id: vesselId },
            select: { id: true, documentFileUrl: true, documents: true },
        })
        if (!vessel) throw new NotFoundException('Không tìm thấy tàu.')
        return this.buildDocumentCheck(vesselId, vessel.documents, vessel.documentFileUrl)
    }

    async listContracts(q: PageQueryDto) {
        const where: Prisma.ShipCharterContractWhereInput = {
            ...(q.status ? { status: q.status as ShipCharterContractStatus } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { contractNo: { contains: q.keyword, mode: 'insensitive' } },
                          { owner: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterContract.findMany({
                where,
                ...this.page(q),
                include: { owner: true, _count: { select: { appendices: true } } },
                orderBy: { signedDate: 'desc' },
            }),
            this.prisma.shipCharterContract.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    contract(id: string) {
        return this.prisma.shipCharterContract.findUniqueOrThrow({
            where: { id },
            include: {
                owner: true,
                lossRates: { orderBy: { productGroup: 'asc' } },
                appendices: { include: { vessel: true, product: true }, orderBy: { appendixDate: 'desc' } },
                orders: { include: { vessel: true }, orderBy: { createdAt: 'desc' }, take: 30 },
                freightRates: { include: { vessel: true, product: true }, orderBy: { effectiveFrom: 'desc' } },
            },
        })
    }

    async saveContract(dto: UpsertShipCharterContractDto, id?: string) {
        await this.assertShipOwner(dto.ownerCustomerId)
        const data = {
            contractNo: dto.contractNo.trim(),
            ownerCustomerId: dto.ownerCustomerId,
            signedDate: dto.signedDate ? new Date(dto.signedDate) : null,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            qtyBasis: dto.qtyBasis?.trim() || 'V15',
            freightVatIncluded: dto.freightVatIncluded ?? false,
            defaultLaytimeHours: dto.defaultLaytimeHours ?? null,
            demurrageRatePerDay: dto.demurrageRatePerDay ?? null,
            paymentTermDays: dto.paymentTermDays ?? null,
            paymentTermText: dto.paymentTermText?.trim() || null,
            status: dto.status ?? ShipCharterContractStatus.DRAFT,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return this.prisma.$transaction(async (tx) => {
            const contract = id
                ? await tx.shipCharterContract.update({ where: { id }, data })
                : await tx.shipCharterContract.create({ data })
            if (dto.lossRates !== undefined) {
                await tx.shipCharterContractLossRate.deleteMany({ where: { contractId: contract.id } })
                if (dto.lossRates.length) {
                    await tx.shipCharterContractLossRate.createMany({
                        data: dto.lossRates.map((rate) => ({
                            contractId: contract.id,
                            productGroup: rate.productGroup.trim(),
                            lossRatePercent: rate.lossRatePercent,
                            note: rate.note?.trim() || null,
                        })),
                    })
                }
            }
            return tx.shipCharterContract.findUniqueOrThrow({
                where: { id: contract.id },
                include: { owner: true, lossRates: { orderBy: { productGroup: 'asc' } } },
            })
        })
    }

    async listAppendices(q: PageQueryDto & { contractId?: string }) {
        const where: Prisma.ShipCharterAppendixWhereInput = {
            ...(q.contractId ? { contractId: q.contractId } : {}),
            ...(q.keyword ? { appendixNo: { contains: q.keyword, mode: 'insensitive' } } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterAppendix.findMany({
                where,
                ...this.page(q),
                include: { contract: { include: { owner: true } }, vessel: true },
                orderBy: { appendixDate: 'desc' },
            }),
            this.prisma.shipCharterAppendix.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    appendix(id: string) {
        return this.prisma.shipCharterAppendix.findUniqueOrThrow({
            where: { id },
            include: {
                contract: { include: { owner: true } },
                vessel: true,
                purchaseOrder: { select: { id: true, orderNo: true } },
                product: true,
                receivingWarehouse: true,
                charterOrders: { select: { id: true, charterOrderNo: true, status: true } },
            },
        })
    }

    async saveAppendix(dto: UpsertShipCharterAppendixDto, id?: string) {
        const contract = await this.prisma.shipCharterContract.findUnique({
            where: { id: dto.contractId },
            select: { ownerCustomerId: true },
        })
        if (!contract) throw new BadRequestException('Không tìm thấy hợp đồng thuê tàu.')
        if (dto.vesselId) {
            const vessel = await this.prisma.vessel.findUnique({ where: { id: dto.vesselId }, select: { ownerCustomerId: true } })
            if (!vessel) throw new BadRequestException('Không tìm thấy tàu đã chọn.')
            if (vessel.ownerCustomerId !== contract.ownerCustomerId) {
                throw new BadRequestException('Tàu trong phụ lục không thuộc chủ tàu của hợp đồng.')
            }
        }
        const data = {
            contractId: dto.contractId,
            appendixNo: dto.appendixNo.trim(),
            appendixDate: new Date(dto.appendixDate),
            vesselId: dto.vesselId ?? null,
            purchaseOrderId: dto.purchaseOrderId ?? null,
            productId: dto.productId ?? null,
            receivingWarehouseId: dto.receivingWarehouseId ?? null,
            cargoName: dto.cargoName?.trim() || null,
            plannedQty: dto.plannedQty,
            plannedQtyUnit: dto.plannedQtyUnit?.trim() || 'LITER',
            qtyTolerancePercent: dto.qtyTolerancePercent,
            loadingPort: dto.loadingPort?.trim() || null,
            dischargePort: dto.dischargePort?.trim() || null,
            laycanFrom: dto.laycanFrom ? new Date(dto.laycanFrom) : null,
            laycanTo: dto.laycanTo ? new Date(dto.laycanTo) : null,
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            qtyBasis: dto.qtyBasis?.trim() || 'V15',
            vatIncluded: dto.vatIncluded ?? false,
            vatRate: dto.vatRate ?? null,
            lossRatePercent: dto.lossRatePercent,
            deliveryMethod: dto.deliveryMethod?.trim() || null,
            paymentTermText: dto.paymentTermText?.trim() || null,
            fileUrl: dto.fileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterAppendix.update({ where: { id }, data })
            : this.prisma.shipCharterAppendix.create({ data })
    }

    async listOrders(q: PageQueryDto & { purchaseOrderId?: string }) {
        const where: Prisma.ShipCharterOrderWhereInput = {
            ...(q.status ? { status: q.status as ShipCharterOrderStatus } : {}),
            ...(q.sourceType ? { sourceType: q.sourceType as ShipCharterOrderSourceType } : {}),
            ...(q.purchaseOrderId ? { purchaseOrderId: q.purchaseOrderId } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { charterOrderNo: { contains: q.keyword, mode: 'insensitive' } },
                          { cargoName: { contains: q.keyword, mode: 'insensitive' } },
                          { purchaseOrder: { orderNo: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterOrder.findMany({
                where,
                ...this.page(q),
                orderBy: [{ laycanFrom: 'asc' }, { createdAt: 'desc' }],
                include: {
                    purchaseOrder: { select: { id: true, orderNo: true } },
                    owner: { select: { id: true, code: true, name: true } },
                    vessel: true,
                    contract: { select: { id: true, contractNo: true } },
                    product: { select: { id: true, code: true, name: true } },
                    receivingWarehouse: { select: { id: true, code: true, name: true } },
                    _count: { select: { insurances: true, inspections: true, agentRegistrations: true } },
                },
            }),
            this.prisma.shipCharterOrder.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    async listPendingTermOrders(q: PageQueryDto) {
        const where: Prisma.PurchaseOrderWhereInput = {
            bizType: 'TERM',
            termProfile: { transportMode: TermTransportMode.SEA, charterRequired: true },
            shipCharterOrders: { none: { status: { not: ShipCharterOrderStatus.CANCELLED } } },
            ...(q.keyword
                ? {
                      OR: [
                          { orderNo: { contains: q.keyword, mode: 'insensitive' } },
                          { supplier: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.purchaseOrder.findMany({
                where,
                ...this.page(q),
                include: {
                    supplier: { select: { id: true, code: true, name: true } },
                    termProfile: true,
                    lines: { include: { product: true, receivingWarehouse: true } },
                    shipments: { orderBy: { createdAt: 'desc' } },
                },
                orderBy: [{ expectedDate: 'asc' }, { createdAt: 'desc' }],
            }),
            this.prisma.purchaseOrder.count({ where }),
        ])
        return {
            items: items.map((item) => ({
                ...item,
                transportMode: item.termProfile?.transportMode,
                charterVessel: item.termProfile?.charterRequired ?? false,
                supplierLocationId: item.lines[0]?.receivingWarehouseId ?? null,
                supplierLocation: item.lines[0]?.receivingWarehouse ?? null,
                totalQty: item.lines.reduce((sum, line) => sum.plus(line.orderedQty), new Prisma.Decimal(0)),
            })),
            total,
            page: q.page,
            pageSize: q.pageSize,
        }
    }

    async order(id: string) {
        const order = await this.prisma.shipCharterOrder.findUniqueOrThrow({
            where: { id },
            include: {
                purchaseOrder: {
                    include: { lines: { include: { product: true, receivingWarehouse: true } }, termProfile: true },
                },
                shipment: true,
                appendix: { include: { contract: true } },
                contract: { include: { lossRates: true } },
                owner: true,
                vessel: { include: { documents: true } },
                product: true,
                receivingWarehouse: true,
                insurances: { include: { insuranceCompany: true }, orderBy: { createdAt: 'desc' } },
                inspections: { include: { inspectionCompany: true }, orderBy: { createdAt: 'desc' } },
                agentRegistrations: { include: { agent: true }, orderBy: { createdAt: 'desc' } },
            },
        })
        return {
            ...order,
            termShipmentId: order.shipmentId,
            termShipment: order.shipment,
            vesselDocumentCheck: order.vessel ? this.buildDocumentCheck(order.vessel.id, order.vessel.documents, order.vessel.documentFileUrl) : null,
        }
    }

    async saveOrder(dto: UpsertShipCharterOrderDto, id?: string) {
        if (dto.ownerCustomerId) await this.assertShipOwner(dto.ownerCustomerId)
        if (dto.vesselId) {
            const vessel = await this.prisma.vessel.findUnique({ where: { id: dto.vesselId }, select: { ownerCustomerId: true } })
            if (!vessel) throw new BadRequestException('Không tìm thấy tàu đã chọn.')
            if (dto.ownerCustomerId && vessel.ownerCustomerId !== dto.ownerCustomerId) {
                throw new BadRequestException('Tàu không thuộc chủ tàu đã chọn.')
            }
        }
        if (dto.contractId) {
            const contract = await this.prisma.shipCharterContract.findUnique({ where: { id: dto.contractId }, select: { ownerCustomerId: true } })
            if (!contract) throw new BadRequestException('Không tìm thấy hợp đồng thuê tàu.')
            if (dto.ownerCustomerId && contract.ownerCustomerId !== dto.ownerCustomerId) {
                throw new BadRequestException('Hợp đồng không thuộc chủ tàu đã chọn.')
            }
        }
        const data = {
            charterOrderNo: dto.charterOrderNo.trim(),
            sourceType: dto.sourceType ?? ShipCharterOrderSourceType.DIRECT,
            purchaseOrderId: dto.purchaseOrderId ?? null,
            shipmentId: dto.termShipmentId ?? null,
            appendixId: dto.appendixId ?? null,
            contractId: dto.contractId ?? null,
            ownerCustomerId: dto.ownerCustomerId,
            vesselId: dto.vesselId ?? null,
            receivingWarehouseId: dto.receivingWarehouseId ?? null,
            productId: dto.productId ?? null,
            laycanFrom: dto.laycanFrom ? new Date(dto.laycanFrom) : null,
            laycanTo: dto.laycanTo ? new Date(dto.laycanTo) : null,
            cargoName: dto.cargoName?.trim() || null,
            plannedQty: dto.plannedQty,
            plannedQtyUnit: dto.plannedQtyUnit?.trim() || 'LITER',
            qtyTolerancePercent: dto.qtyTolerancePercent ?? null,
            loadingPort: dto.loadingPort?.trim() || null,
            dischargePort: dto.dischargePort?.trim() || null,
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            qtyBasis: dto.qtyBasis?.trim() || 'V15',
            vatIncluded: dto.vatIncluded ?? false,
            vatRate: dto.vatRate ?? null,
            lossRatePercent: dto.lossRatePercent,
            insuranceRequired: dto.insuranceRequired ?? false,
            appendixFileUrl: dto.appendixFileUrl?.trim() || null,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterOrder.update({ where: { id }, data })
            : this.prisma.shipCharterOrder.create({ data })
    }

    async createOrderFromTerm(purchaseOrderId: string, dto: CreateCharterOrderFromTermDto) {
        const purchaseOrder = await this.prisma.purchaseOrder.findUnique({
            where: { id: purchaseOrderId },
            include: {
                lines: { include: { product: true, receivingWarehouse: true }, orderBy: { lineNo: 'asc' } },
                termProfile: true,
                shipments: { orderBy: { createdAt: 'desc' } },
                shipCharterOrders: { where: { status: { not: ShipCharterOrderStatus.CANCELLED } } },
            },
        })
        if (!purchaseOrder) throw new NotFoundException('Không tìm thấy đơn TERM.')
        if (
            purchaseOrder.termProfile?.transportMode !== TermTransportMode.SEA ||
            !purchaseOrder.termProfile.charterRequired
        ) {
            throw new BadRequestException('Đơn TERM không thuộc luồng vận chuyển đường biển có thuê tàu.')
        }
        const shipment = dto.termShipmentId
            ? purchaseOrder.shipments.find((item) => item.id === dto.termShipmentId)
            : purchaseOrder.shipments[0]
        if (dto.termShipmentId && !shipment) throw new BadRequestException('Chuyến tàu TERM không thuộc đơn đã chọn.')
        const duplicated = purchaseOrder.shipCharterOrders.find((item) =>
            shipment ? item.shipmentId === shipment.id : item.shipmentId === null,
        )
        if (duplicated) throw new BadRequestException('Đơn TERM này đã có đơn thuê tàu đang hoạt động.')
        const firstLine = purchaseOrder.lines[0]
        return this.prisma.shipCharterOrder.create({
            data: {
                charterOrderNo: dto.charterOrderNo?.trim() || this.generatedNo('CT'),
                sourceType: ShipCharterOrderSourceType.FROM_TERM,
                purchaseOrderId,
                shipmentId: shipment?.id ?? null,
                vesselId: shipment?.vesselId ?? null,
                receivingWarehouseId: firstLine?.receivingWarehouseId ?? null,
                productId: firstLine?.productId ?? null,
                cargoName: firstLine?.product.name ?? null,
                plannedQty: purchaseOrder.lines.reduce(
                    (sum, line) => sum.plus(line.orderedQty),
                    new Prisma.Decimal(0),
                ),
                plannedQtyUnit: firstLine?.product.uom ?? 'LITER',
                loadingPort: shipment?.loadingPort ?? purchaseOrder.deliveryLocation,
                dischargePort: shipment?.dischargePort ?? firstLine?.receivingWarehouse?.name,
                laycanFrom: shipment?.etd ?? purchaseOrder.expectedDate,
                laycanTo: shipment?.eta ?? purchaseOrder.expectedDate,
                status: ShipCharterOrderStatus.DRAFT,
            },
            include: { purchaseOrder: true, shipment: true, vessel: true, product: true, receivingWarehouse: true },
        })
    }

    async lookupFreightRate(q: ShipFreightRateLookupDto) {
        const at = q.laycanDate ? new Date(q.laycanDate) : new Date()
        const candidates = await this.prisma.shipFreightRate.findMany({
            where: {
                status: ShipFreightRateStatus.ACTIVE,
                loadingPort: { equals: q.loadingPort.trim(), mode: 'insensitive' },
                dischargePort: { equals: q.dischargePort.trim(), mode: 'insensitive' },
                effectiveFrom: { lte: at },
                OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
                AND: [
                    { OR: [{ ownerCustomerId: null }, ...(q.ownerCustomerId ? [{ ownerCustomerId: q.ownerCustomerId }] : [])] },
                    { OR: [{ vesselId: null }, ...(q.vesselId ? [{ vesselId: q.vesselId }] : [])] },
                    { OR: [{ productId: null }, ...(q.productId ? [{ productId: q.productId }] : [])] },
                    { OR: [{ productGroup: null }, ...(q.productGroup ? [{ productGroup: q.productGroup }] : [])] },
                ],
            },
            include: { owner: true, vessel: true, contract: true, appendix: true, product: true },
        })
        const sourceScore: Record<ShipFreightRateSourceType, number> = {
            APPENDIX: 400,
            CONTRACT: 200,
            MANUAL: 100,
        }
        const score = (rate: (typeof candidates)[number]) =>
            sourceScore[rate.sourceType] +
            (q.vesselId && rate.vesselId === q.vesselId ? 80 : 0) +
            (q.ownerCustomerId && rate.ownerCustomerId === q.ownerCustomerId ? 40 : 0) +
            (q.productId && rate.productId === q.productId ? 20 : 0) +
            (q.productGroup && rate.productGroup === q.productGroup ? 10 : 0) +
            rate.effectiveFrom.getTime() / 1e13
        const selected = candidates.sort((left, right) => score(right) - score(left))[0]
        if (!selected) return { matched: false, rate: null }
        return {
            matched: true,
            rate: selected,
            defaults: {
                freightRateVndPerLiter: selected.freightRateVndPerLiter,
                lossRatePercent: selected.allowedLossRatePercent,
                qtyBasis: selected.qtyBasis,
                vatIncluded: selected.vatIncluded,
                vatRate: selected.vatRate,
            },
        }
    }

    async createAppendixFromOrder(orderId: string, dto: CreateAppendixFromOrderDto) {
        return this.prisma.$transaction(async (tx) => {
            const order = await tx.shipCharterOrder.findUnique({ where: { id: orderId } })
            if (!order) throw new NotFoundException('Không tìm thấy đơn thuê tàu.')
            if (order.appendixId) throw new BadRequestException('Đơn thuê tàu đã có phụ lục hợp đồng.')
            if (!order.contractId || !order.ownerCustomerId || !order.vesselId || !order.laycanFrom || !order.laycanTo ||
                !order.loadingPort || !order.dischargePort || !order.cargoName || order.plannedQty.lessThanOrEqualTo(0) ||
                !order.freightRateVndPerLiter || order.lossRatePercent === null) {
                throw new BadRequestException('Đơn thuê tàu chưa đủ hợp đồng, tàu, laycan, tuyến, hàng hóa, số lượng, giá thuê và tỷ lệ hao hụt.')
            }
            if (order.status !== ShipCharterOrderStatus.CONFIRMED && order.status !== ShipCharterOrderStatus.IN_PROGRESS) {
                throw new BadRequestException('Chỉ sinh phụ lục từ đơn đã xác nhận.')
            }
            const appendix = await tx.shipCharterAppendix.create({
                data: {
                    contractId: order.contractId,
                    appendixNo: dto.appendixNo.trim(),
                    appendixDate: new Date(dto.appendixDate),
                    vesselId: order.vesselId,
                    purchaseOrderId: order.purchaseOrderId,
                    productId: order.productId,
                    receivingWarehouseId: order.receivingWarehouseId,
                    cargoName: order.cargoName,
                    plannedQty: order.plannedQty,
                    plannedQtyUnit: order.plannedQtyUnit,
                    qtyTolerancePercent: order.qtyTolerancePercent,
                    loadingPort: order.loadingPort,
                    dischargePort: order.dischargePort,
                    laycanFrom: order.laycanFrom,
                    laycanTo: order.laycanTo,
                    freightRateVndPerLiter: order.freightRateVndPerLiter,
                    qtyBasis: order.qtyBasis,
                    vatIncluded: order.vatIncluded,
                    vatRate: order.vatRate,
                    lossRatePercent: order.lossRatePercent,
                    fileUrl: dto.fileUrl?.trim() || null,
                },
            })
            await tx.shipCharterOrder.update({
                where: { id: orderId },
                data: { appendixId: appendix.id, appendixFileUrl: appendix.fileUrl, status: ShipCharterOrderStatus.APPENDIX_CREATED },
            })
            return appendix
        })
    }

    async changeOrderStatus(id: string, status: ShipCharterOrderStatus, overrideDocumentCheck = false) {
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.shipCharterOrder.findUnique({
                where: { id },
                include: {
                    purchaseOrder: { include: { lines: true } },
                    vessel: { include: { documents: true } },
                    contract: true,
                },
            })
            if (!row) throw new NotFoundException('Charter order not found')
            if (
                status === ShipCharterOrderStatus.CONFIRMED &&
                (!row.ownerCustomerId ||
                    !row.vesselId ||
                    !row.contractId ||
                    !row.laycanFrom ||
                    !row.laycanTo ||
                    !row.cargoName ||
                    !row.loadingPort ||
                    !row.dischargePort ||
                    new Prisma.Decimal(row.plannedQty).lessThanOrEqualTo(0) ||
                    !row.freightRateVndPerLiter ||
                    row.lossRatePercent === null)
            ) {
                throw new BadRequestException(
                    'Đơn thuê tàu phải đủ chủ tàu, tàu, hợp đồng, laycan, tuyến, hàng hóa, số lượng, giá thuê và hao hụt trước khi xác nhận.',
                )
            }
            if (status === ShipCharterOrderStatus.CONFIRMED) {
                if (!row.vessel) throw new BadRequestException('Không tìm thấy tàu đã chọn.')
                if (row.vessel.ownerCustomerId !== row.ownerCustomerId) {
                    throw new BadRequestException('Tàu không thuộc chủ tàu trên đơn thuê tàu.')
                }
                if (!row.contract || row.contract.ownerCustomerId !== row.ownerCustomerId) {
                    throw new BadRequestException('Hợp đồng không thuộc chủ tàu trên đơn thuê tàu.')
                }
                const documentCheck = this.buildDocumentCheck(row.vessel.id, row.vessel.documents, row.vessel.documentFileUrl)
                if (!documentCheck.isReady && !overrideDocumentCheck) {
                    throw new BadRequestException({
                        message: 'Hồ sơ tàu còn thiếu hoặc đã hết hạn. Cần hoàn thiện hồ sơ trước khi xác nhận.',
                        code: 'VESSEL_DOCUMENTS_NOT_READY',
                        documentCheck,
                    })
                }
            }
            const allowed: Record<ShipCharterOrderStatus, ShipCharterOrderStatus[]> = {
                DRAFT: [ShipCharterOrderStatus.WAITING_CONFIRMATION, ShipCharterOrderStatus.CONFIRMED, ShipCharterOrderStatus.CANCELLED],
                WAITING_CONFIRMATION: [ShipCharterOrderStatus.CONFIRMED, ShipCharterOrderStatus.CANCELLED],
                CONFIRMED: [ShipCharterOrderStatus.APPENDIX_CREATED, ShipCharterOrderStatus.IN_PROGRESS, ShipCharterOrderStatus.CANCELLED],
                APPENDIX_CREATED: [ShipCharterOrderStatus.IN_PROGRESS, ShipCharterOrderStatus.CANCELLED],
                IN_PROGRESS: [ShipCharterOrderStatus.COMPLETED, ShipCharterOrderStatus.CANCELLED],
                COMPLETED: [],
                CANCELLED: [],
            }
            if (!allowed[row.status].includes(status)) throw new BadRequestException(`Invalid transition ${row.status} -> ${status}`)

            if (status === ShipCharterOrderStatus.CONFIRMED && row.purchaseOrder) {
                for (const line of row.purchaseOrder.lines) {
                    const warehouseId = line.receivingWarehouseId
                    if (!warehouseId) throw new BadRequestException('Đơn mua chưa có kho nhận hàng.')
                    const warehouse = await tx.warehouse.findUnique({
                        where: { id: warehouseId },
                        select: { legalEntity: { select: { partyId: true } } },
                    })
                    if (!warehouse) throw new BadRequestException('Không tìm thấy kho nhận hàng của đơn thuê tàu.')
                    await tx.expectedSupply.upsert({
                        where: { expectedNo: `EXP-CHARTER-${row.id}-${line.id}` },
                        create: {
                            expectedNo: `EXP-CHARTER-${row.id}-${line.id}`,
                            warehouseId,
                            productId: line.productId,
                            ownerPartyId: warehouse.legalEntity.partyId,
                            purchaseOrderLineId: line.id,
                            expectedActualQty: line.orderedQty,
                            expectedAt: row.laycanTo,
                        },
                        update: {},
                    })
                }
            }
            return tx.shipCharterOrder.update({ where: { id }, data: { status } })
        })
    }

    async saveInsurance(orderId: string, dto: UpsertCharterInsuranceDto, id?: string) {
        await this.assertPartnerRole(dto.insuranceCompanyId, OperationalPartyRole.INSURER, 'Công ty bảo hiểm')
        const data = {
            charterOrderId: orderId,
            insuranceCompanyId: dto.insuranceCompanyId,
            policyNo: dto.policyNo?.trim() || null,
            policyDate: dto.policyDate ? new Date(dto.policyDate) : null,
            insuredValue: dto.insuredValue,
            premiumAmount: dto.premiumAmount,
            effectiveFrom: dto.effectiveFrom ? new Date(dto.effectiveFrom) : null,
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterInsurance.update({ where: { id }, data })
            : this.prisma.shipCharterInsurance.create({ data })
    }

    async saveInsuranceForExisting(id: string, dto: UpsertCharterInsuranceDto) {
        const existing = await this.prisma.shipCharterInsurance.findUnique({ where: { id }, select: { charterOrderId: true } })
        if (!existing) throw new NotFoundException('Không tìm thấy đăng ký bảo hiểm.')
        return this.saveInsurance(existing.charterOrderId, dto, id)
    }

    async saveInspection(orderId: string, dto: UpsertCharterInspectionDto, id?: string) {
        await this.assertPartnerRole(dto.inspectionCompanyId, OperationalPartyRole.SURVEYOR, 'Đơn vị giám định')
        const data = {
            charterOrderId: orderId,
            inspectionCompanyId: dto.inspectionCompanyId,
            inspectionType: dto.inspectionType,
            registeredDate: dto.registeredDate ? new Date(dto.registeredDate) : null,
            plannedInspectionDate: dto.plannedInspectionDate ? new Date(dto.plannedInspectionDate) : null,
            certificateNo: dto.certificateNo?.trim() || null,
            feeAmount: dto.feeAmount ?? 0,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipCharterInspection.update({ where: { id }, data })
            : this.prisma.shipCharterInspection.create({ data })
    }

    async saveInspectionForExisting(id: string, dto: UpsertCharterInspectionDto) {
        const existing = await this.prisma.shipCharterInspection.findUnique({ where: { id }, select: { charterOrderId: true } })
        if (!existing) throw new NotFoundException('Không tìm thấy đăng ký giám định.')
        return this.saveInspection(existing.charterOrderId, dto, id)
    }

    async saveAgent(orderId: string, dto: UpsertShippingAgentDto, id?: string) {
        await this.assertPartnerRole(dto.agentCustomerId, OperationalPartyRole.SHIPPING_AGENT, 'Đại lý tàu')
        const data = {
            charterOrderId: orderId,
            agentCustomerId: dto.agentCustomerId,
            registeredDate: dto.registeredDate ? new Date(dto.registeredDate) : null,
            agencyFee: dto.agencyFee,
            fileUrl: dto.fileUrl?.trim() || null,
            status: dto.status ?? OperationRegistrationStatus.DRAFT,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shippingAgentRegistration.update({ where: { id }, data })
            : this.prisma.shippingAgentRegistration.create({ data })
    }

    async saveAgentForExisting(id: string, dto: UpsertShippingAgentDto) {
        const existing = await this.prisma.shippingAgentRegistration.findUnique({ where: { id }, select: { charterOrderId: true } })
        if (!existing) throw new NotFoundException('Không tìm thấy đăng ký đại lý tàu.')
        return this.saveAgent(existing.charterOrderId, dto, id)
    }

    async listInsurances(q: PageQueryDto) {
        const where: Prisma.ShipCharterInsuranceWhereInput = {
            ...(q.status ? { status: q.status as OperationRegistrationStatus } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { policyNo: { contains: q.keyword, mode: 'insensitive' } },
                          { charterOrder: { charterOrderNo: { contains: q.keyword, mode: 'insensitive' } } },
                          { insuranceCompany: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterInsurance.findMany({ where, ...this.page(q), include: { charterOrder: true, insuranceCompany: true }, orderBy: { createdAt: 'desc' } }),
            this.prisma.shipCharterInsurance.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    async listInspections(q: PageQueryDto) {
        const where: Prisma.ShipCharterInspectionWhereInput = {
            ...(q.status ? { status: q.status as OperationRegistrationStatus } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { certificateNo: { contains: q.keyword, mode: 'insensitive' } },
                          { charterOrder: { charterOrderNo: { contains: q.keyword, mode: 'insensitive' } } },
                          { inspectionCompany: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipCharterInspection.findMany({ where, ...this.page(q), include: { charterOrder: true, inspectionCompany: true }, orderBy: { createdAt: 'desc' } }),
            this.prisma.shipCharterInspection.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    async listAgentRegistrations(q: PageQueryDto) {
        const where: Prisma.ShippingAgentRegistrationWhereInput = {
            ...(q.status ? { status: q.status as OperationRegistrationStatus } : {}),
            ...(q.keyword
                ? {
                      OR: [
                          { charterOrder: { charterOrderNo: { contains: q.keyword, mode: 'insensitive' } } },
                          { agent: { name: { contains: q.keyword, mode: 'insensitive' } } },
                      ],
                  }
                : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shippingAgentRegistration.findMany({ where, ...this.page(q), include: { charterOrder: true, agent: true }, orderBy: { createdAt: 'desc' } }),
            this.prisma.shippingAgentRegistration.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    async listFreightRates(q: PageQueryDto) {
        const where: Prisma.ShipFreightRateWhereInput = {
            ...(q.status ? { status: q.status as ShipFreightRateStatus } : {}),
            ...(q.keyword ? {
                  OR: [
                      { loadingPort: { contains: q.keyword, mode: 'insensitive' } },
                      { dischargePort: { contains: q.keyword, mode: 'insensitive' } },
                      { productGroup: { contains: q.keyword, mode: 'insensitive' } },
                      { rateCode: { contains: q.keyword, mode: 'insensitive' } },
                      { routeName: { contains: q.keyword, mode: 'insensitive' } },
                  ],
              } : {}),
        }
        const [items, total] = await this.prisma.$transaction([
            this.prisma.shipFreightRate.findMany({
                where,
                ...this.page(q),
                include: { owner: true, vessel: true, contract: true, appendix: true, product: true },
                orderBy: { effectiveFrom: 'desc' },
            }),
            this.prisma.shipFreightRate.count({ where }),
        ])
        return { items, total, page: q.page, pageSize: q.pageSize }
    }

    saveFreightRate(dto: UpsertShipFreightRateDto, id?: string) {
        const data = {
            rateCode: dto.rateCode.trim(),
            ownerCustomerId: dto.ownerCustomerId ?? null,
            vesselId: dto.vesselId ?? null,
            contractId: dto.contractId ?? null,
            appendixId: dto.appendixId ?? null,
            sourceType: dto.sourceType ?? ShipFreightRateSourceType.MANUAL,
            loadingPort: dto.loadingPort.trim(),
            dischargePort: dto.dischargePort.trim(),
            routeName: dto.routeName?.trim() || null,
            productGroup: dto.productGroup?.trim() || null,
            productId: dto.productId ?? null,
            qtyBasis: dto.qtyBasis?.trim() || 'V15',
            freightRateVndPerLiter: dto.freightRateVndPerLiter,
            rateUnit: dto.rateUnit?.trim() || 'VND_PER_LITER',
            currency: dto.currency?.trim() || 'VND',
            vatIncluded: dto.vatIncluded ?? false,
            vatRate: dto.vatRate ?? null,
            allowedLossRatePercent: dto.allowedLossRatePercent ?? null,
            effectiveFrom: new Date(dto.effectiveFrom),
            effectiveTo: dto.effectiveTo ? new Date(dto.effectiveTo) : null,
            status: dto.status ?? ShipFreightRateStatus.ACTIVE,
            note: dto.note?.trim() || null,
        }
        return id
            ? this.prisma.shipFreightRate.update({ where: { id }, data })
            : this.prisma.shipFreightRate.create({ data })
    }

    async shipCharterDashboard() {
        const now = new Date()
        const warningDate = new Date(now)
        warningDate.setDate(warningDate.getDate() + 30)
        const activeOrderFilter: Prisma.ShipCharterOrderWhereInput = {
            status: { notIn: [ShipCharterOrderStatus.COMPLETED, ShipCharterOrderStatus.CANCELLED] },
        }
        const [
            termOrdersPending,
            draftOrders,
            ordersWithoutAppendix,
            insurancePending,
            inspectionPending,
            agentPending,
            laycanSoon,
            contractsExpiringSoon,
            appendicesMissingFile,
            vessels,
            selectedVessels,
        ] = await Promise.all([
            this.prisma.purchaseOrder.count({
                where: {
                    bizType: 'TERM',
                    termProfile: { transportMode: TermTransportMode.SEA, charterRequired: true },
                    shipCharterOrders: { none: { status: { not: ShipCharterOrderStatus.CANCELLED } } },
                },
            }),
            this.prisma.shipCharterOrder.count({ where: { status: ShipCharterOrderStatus.DRAFT } }),
            this.prisma.shipCharterOrder.count({ where: { ...activeOrderFilter, appendixId: null } }),
            this.prisma.shipCharterOrder.count({
                where: { ...activeOrderFilter, insuranceRequired: true, insurances: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } } },
            }),
            this.prisma.shipCharterOrder.count({
                where: { ...activeOrderFilter, inspections: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } } },
            }),
            this.prisma.shipCharterOrder.count({
                where: { ...activeOrderFilter, agentRegistrations: { none: { status: { not: OperationRegistrationStatus.CANCELLED } } } },
            }),
            this.prisma.shipCharterOrder.count({
                where: { ...activeOrderFilter, laycanFrom: { gte: now, lte: warningDate } },
            }),
            this.prisma.shipCharterContract.count({
                where: { status: ShipCharterContractStatus.ACTIVE, effectiveTo: { gte: now, lte: warningDate } },
            }),
            this.prisma.shipCharterAppendix.count({ where: { OR: [{ fileUrl: null }, { fileUrl: '' }] } }),
            this.prisma.vessel.findMany({ where: { isActive: true }, select: { id: true, documentFileUrl: true, documents: true } }),
            this.prisma.shipCharterOrder.findMany({
                where: { ...activeOrderFilter, vesselId: { not: null } },
                distinct: ['vesselId'],
                select: { vesselId: true },
            }),
        ])
        const checks = vessels.map((vessel) => this.buildDocumentCheck(vessel.id, vessel.documents, vessel.documentFileUrl))
        const notReadyIds = new Set(checks.filter((check) => !check.isReady).map((check) => check.vesselId))
        return {
            termOrdersPending,
            draftOrders,
            ordersWithoutAppendix,
            insurancePending,
            inspectionPending,
            agentPending,
            laycanSoon,
            contractsExpiringSoon,
            vesselsMissingDocuments: checks.filter((check) => check.missingCount > 0).length,
            vesselsWithExpiredDocuments: checks.filter((check) => check.expiredCount > 0).length,
            vesselsWithExpiringDocuments: checks.filter((check) => check.expiringSoonCount > 0).length,
            selectedVesselsNotReady: selectedVessels.filter((item) => item.vesselId && notReadyIds.has(item.vesselId)).length,
            appendicesMissingFile,
        }
    }

    async postCostsToTerm(orderId: string) {
        const order = await this.order(orderId)
        if (!order.purchaseOrderId) throw new BadRequestException('Charter order is not linked to a TERM purchase order')
        const sources: Array<{
            sourceType: OperationalCostSourceType
            sourceId: string
            type: TermLogisticsCostType
            amount: Prisma.Decimal
            vendorCustomerId?: string | null
            documentNo?: string | null
        }> = []
        if (order.freightRateVndPerLiter) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_FREIGHT,
                sourceId: order.id,
                type: TermLogisticsCostType.FREIGHT,
                amount: new Prisma.Decimal(order.freightRateVndPerLiter).mul(order.plannedQty),
                vendorCustomerId: order.ownerCustomerId,
                documentNo: order.charterOrderNo,
            })
        }
        for (const x of order.insurances.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_INSURANCE,
                sourceId: x.id,
                type: TermLogisticsCostType.INSURANCE,
                amount: new Prisma.Decimal(x.premiumAmount),
                vendorCustomerId: x.insuranceCompanyId,
                documentNo: x.policyNo,
            })
        }
        for (const x of order.inspections.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIP_CHARTER_INSPECTION,
                sourceId: x.id,
                type: TermLogisticsCostType.INSPECTION,
                amount: new Prisma.Decimal(x.feeAmount),
                vendorCustomerId: x.inspectionCompanyId,
                documentNo: x.certificateNo,
            })
        }
        for (const x of order.agentRegistrations.filter((x) => x.status !== OperationRegistrationStatus.CANCELLED)) {
            sources.push({
                sourceType: OperationalCostSourceType.SHIPPING_AGENT,
                sourceId: x.id,
                type: TermLogisticsCostType.HANDLING,
                amount: new Prisma.Decimal(x.agencyFee),
                vendorCustomerId: x.agentCustomerId,
            })
        }

        return this.prisma.$transaction(async (tx) => {
            const posted: string[] = []
            for (const source of sources.filter((x) => x.amount.greaterThan(0))) {
                const existing = await tx.termLogisticsCostLine.findUnique({
                    where: {
                        operationsSourceType_operationsSourceId: {
                            operationsSourceType: source.sourceType,
                            operationsSourceId: source.sourceId,
                        },
                    },
                })
                if (existing) {
                    posted.push(existing.id)
                    continue
                }
                const header = await tx.termLogisticsCost.create({
                    data: {
                        purchaseOrderId: order.purchaseOrderId!,
                        shipmentId: order.shipmentId,
                        vendorCustomerId: source.vendorCustomerId,
                        documentNo: source.documentNo,
                        documentDate: new Date(),
                        totalBeforeVat: source.amount,
                        totalAfterVat: source.amount,
                        status: TermLogisticsCostStatus.CONFIRMED,
                        note: `Posted from operations charter ${order.charterOrderNo}`,
                    },
                })
                const line = await tx.termLogisticsCostLine.create({
                    data: {
                        logisticsCostId: header.id,
                        costType: source.type,
                        amountBeforeVat: source.amount,
                        amountAfterVat: source.amount,
                        amountVndBeforeVat: source.amount,
                        operationsSourceType: source.sourceType,
                        operationsSourceId: source.sourceId,
                        note: `Operations source ${source.sourceType}`,
                    },
                })
                posted.push(line.id)
            }
            return { postedCount: posted.length, lineIds: posted }
        })
    }
}
