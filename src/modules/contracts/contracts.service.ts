import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { ContractStatus, Prisma } from '@prisma/client'
import { AssignContractsToCustomerDto } from '../customers/dto/assign-contracts.dto'
import { AssignCustomerToContractDto } from './dto/assign-customer.dto'
import { addDays, diffInDays, startOfDay, subDays } from 'src/common/utils/date.utils'
import { CONTRACT_EXPIRED_WITHIN_DAYS, CONTRACT_EXPIRING_IN_DAYS } from 'src/common/constants/constants'
import { ContractExpiryCounts, ContractExpiryListItem, ContractExpiryListParams, ContractExpiryListResult } from './contracts-expiry.types'

@Injectable()
export class ContractsService {
    constructor(private prisma: PrismaService) {}

    private async getContractOrThrow(contractId: string) {
        const contract = await this.prisma.contract.findUnique({
            where: { id: contractId },
        })

        if (!contract || contract.deletedAt) {
            throw new NotFoundException('Không tìm thấy hợp đồng')
        }

        return contract
    }

    private async getCustomerOrThrow(customerId: string) {
        const customer = await this.prisma.customer.findFirst({
            where: { id: customerId, deletedAt: null },
        })

        if (!customer) {
            throw new NotFoundException('Không tìm thấy khách hàng')
        }

        return customer
    }

    private async findOverlapsForCustomer(params: { customerId: string; startDate: Date; endDate: Date; excludeContractId?: string }) {
        const { customerId, startDate, endDate, excludeContractId } = params

        return this.prisma.contract.findMany({
            where: {
                customerId,
                deletedAt: null,
                id: excludeContractId ? { not: excludeContractId } : undefined,
                startDate: { lte: endDate },
                endDate: { gte: startDate },
            },
            select: {
                id: true,
                code: true,
                startDate: true,
                endDate: true,
                status: true,
            },
            orderBy: { startDate: 'asc' },
        })
    }

    async assignCustomerToContract(contractId: string, dto: AssignCustomerToContractDto) {
        const contract = await this.getContractOrThrow(contractId)
        const customer = await this.getCustomerOrThrow(dto.customerId)

        if (contract.status === ContractStatus.Cancelled) {
            throw new BadRequestException('Không thể gán hợp đồng đã hủy')
        }

        // HĐ đã gán KH khác rồi
        if (contract.customerId && contract.customerId !== customer.id) {
            throw new ConflictException('Hợp đồng đã được gán cho khách hàng khác')
        }

        // Check trùng thời gian với các HĐ khác của KH này
        const overlaps = await this.findOverlapsForCustomer({
            customerId: customer.id,
            startDate: contract.startDate,
            endDate: contract.endDate,
            excludeContractId: contract.id,
        })

        if (overlaps.length > 0) {
            const o = overlaps[0]
            throw new ConflictException(`Thời gian hợp đồng trùng với ${o.code} (${o.startDate.toISOString()} – ${o.endDate.toISOString()})`)
        }

        const updated = await this.prisma.contract.update({
            where: { id: contract.id },
            data: { customerId: customer.id },
        })

        return updated
    }

    /**
     * N HĐ → 1 KH (màn Customer: gán nhiều hợp đồng cho 1 khách)
     */
    async assignContractsToCustomer(customerId: string, dto: AssignContractsToCustomerDto) {
        const customer = await this.getCustomerOrThrow(customerId)

        const assigned: string[] = []
        const failed: { contractId: string; code: string; reason: string }[] = []

        for (const contractId of dto.contractIds) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const contract = await tx.contract.findUnique({ where: { id: contractId } })

                    if (!contract || contract.deletedAt) {
                        throw new BadRequestException('Không tìm thấy hợp đồng')
                    }

                    if (contract.status === ContractStatus.Cancelled) {
                        throw new BadRequestException('Không thể gán hợp đồng đã hủy')
                    }

                    if (contract.customerId && contract.customerId !== customer.id) {
                        throw new ConflictException('Hợp đồng đã được gán cho khách hàng khác')
                    }

                    const overlaps = await this.findOverlapsForCustomer({
                        customerId: customer.id,
                        startDate: contract.startDate,
                        endDate: contract.endDate,
                        excludeContractId: contract.id,
                    })

                    if (overlaps.length > 0) {
                        const o = overlaps[0]
                        throw new ConflictException(`Contract period overlaps with ${o.code} (${o.startDate.toISOString()} – ${o.endDate.toISOString()})`)
                    }

                    await tx.contract.update({
                        where: { id: contract.id },
                        data: { customerId: customer.id },
                    })
                })

                assigned.push(contractId)
            } catch (e: any) {
                failed.push({
                    contractId,
                    code: e?.name || 'ERROR',
                    reason: e?.message || 'Unknown error',
                })
            }
        }

        return {
            customerId: customer.id,
            assigned,
            failed,
        }
    }

    /**
     * Gỡ gán 1 HĐ khỏi 1 KH (màn Customer)
     */
    async unassignContractFromCustomer(customerId: string, contractId: string) {
        const contract = await this.getContractOrThrow(contractId)

        if (contract.customerId !== customerId) {
            throw new NotFoundException('Hợp đồng không thuộc khách hàng này')
        }

        const updated = await this.prisma.contract.update({
            where: { id: contract.id },
            data: { customerId: null },
        })

        return updated
    }

    // LIST
    async list(query: ContractListQueryDto) {
        const { keyword, customerId, status, riskLevel, startFrom, startTo, endFrom, endTo, page = 1, pageSize = 20 } = query

        const startFromDate = startFrom ? new Date(startFrom) : undefined
        const startToDate = startTo ? new Date(startTo) : undefined
        const endFromDate = endFrom ? new Date(endFrom) : undefined
        const endToDate = endTo ? new Date(endTo) : undefined
        const where: Prisma.ContractWhereInput = {
            deletedAt: null,
            ...(keyword
                ? {
                      OR: [{ code: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }],
                  }
                : {}),
            ...(customerId ? { customerId } : {}),
            ...(status ? { status } : {}),
            ...(riskLevel ? { riskLevel } : {}),
            ...(startFromDate || startToDate
                ? {
                      startDate: {
                          ...(startFromDate ? { gte: startFromDate } : {}),
                          ...(startToDate ? { lte: startToDate } : {}),
                      },
                  }
                : {}),

            ...(endFromDate || endToDate
                ? {
                      endDate: {
                          ...(endFromDate ? { gte: endFromDate } : {}),
                          ...(endToDate ? { lte: endToDate } : {}),
                      },
                  }
                : {}),
        }

        const [rows, total] = await this.prisma.$transaction([
            this.prisma.contract.findMany({
                where,
                orderBy: { startDate: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                include: {
                    customer: { select: { id: true, code: true, name: true, salesOwnerEmp: { select: { fullName: true } }, accountingOwnerEmp: { select: { fullName: true } } } },
                    contractType: { select: { id: true, code: true, name: true } },
                    attachments: {
                        select: {
                            id: true,
                            fileName: true,
                            fileUrl: true,
                            externalUrl: true,
                        },
                    },
                },
            }),
            this.prisma.contract.count({ where }),
        ])

        // 🔹 Map ra đúng dạng ContractListItem cho FE
        const items = rows.map((c) => ({
            id: c.id,
            code: c.code,
            name: c.name,

            customerId: c.customerId,
            customerCode: c.customer?.code ?? null,
            customerName: c.customer?.name ?? null,
            salesOwnerName: c.customer?.salesOwnerEmp?.fullName ?? null,
            accountingOwnerName: c.customer?.accountingOwnerEmp?.fullName ?? null,

            contractTypeId: c.contractTypeId,
            contractTypeCode: c.contractType?.code ?? null,
            contractTypeName: c.contractType?.name ?? null,

            startDate: c.startDate.toISOString(),
            endDate: c.endDate.toISOString(),

            status: c.status,
            riskLevel: c.riskLevel,

            paymentTermDays: c.paymentTermDays,
            creditLimitOverride: c.creditLimitOverride,

            attachments: c.attachments ?? [],
        }))

        return { items, total, page, pageSize }
    }

    // CREATE
    async create(dto: CreateContractDto) {
        return this.prisma.contract.create({
            data: {
                code: dto.code,
                name: dto.name,
                startDate: new Date(dto.startDate),
                endDate: new Date(dto.endDate),
                status: dto.status,
                paymentTermDays: dto.paymentTermDays,
                creditLimitOverride: dto.creditLimitOverride,
                sla: dto.sla,
                deliveryScope: dto.deliveryScope,
                riskLevel: dto.riskLevel,
                approvalRequestId: dto.approvalRequestId,
                customer: dto.customerId ? { connect: { id: dto.customerId } } : undefined,
                contractType: { connect: { id: dto.contractTypeId } },
                renewalOf: dto.renewalOfId ? { connect: { id: dto.renewalOfId } } : undefined,
            },
        })
    }

    // DETAIL
    async detail(id: string) {
        const contract = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
            include: {
                customer: true,
                contractType: true,
                renewalOf: true,
                renewals: true,
                attachments: true,
            },
        })

        if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng')
        return contract
    }

    // UPDATE
    async update(id: string, dto: UpdateContractDto) {
        const existing = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng')

        return this.prisma.contract.update({
            where: { id },
            data: {
                code: dto.code ?? undefined,
                name: dto.name ?? undefined,
                startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                status: dto.status ?? undefined,
                paymentTermDays: dto.paymentTermDays,
                creditLimitOverride: dto.creditLimitOverride !== undefined ? dto.creditLimitOverride : undefined,
                sla: dto.sla,
                deliveryScope: dto.deliveryScope,
                riskLevel: dto.riskLevel,
                approvalRequestId: dto.approvalRequestId,
                customer: dto.customerId ? { connect: { id: dto.customerId } } : dto.customerId === null ? { disconnect: true } : undefined,
                contractType: dto.contractTypeId ? { connect: { id: dto.contractTypeId } } : undefined,
                renewalOf: dto.renewalOfId ? { connect: { id: dto.renewalOfId } } : dto.renewalOfId === null ? { disconnect: true } : undefined,
            },
        })
    }

    // REMOVE
    async remove(id: string) {
        const existing = await this.prisma.contract.findFirst({
            where: { id, deletedAt: null },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng')

        return this.prisma.contract.update({
            where: { id },
            data: { deletedAt: new Date() },
        })
    }

    /**
     * Đếm số HĐ sắp hết hạn / đã quá hạn tại 1 ngày tham chiếu.
     * Dùng cho:
     * - Bell (bootstrap)
     * - Summary của màn báo cáo
     */

    async getContractExpiryCounts(referenceDate: Date = new Date()): Promise<ContractExpiryCounts> {
        const ref = startOfDay(referenceDate)

        const expiringEnd = addDays(ref, CONTRACT_EXPIRING_IN_DAYS)
        const expiredStart = subDays(ref, CONTRACT_EXPIRED_WITHIN_DAYS)

        const activeStatus = ContractStatus.Active

        // Sắp hết hạn: endDate ∈ [ref, ref + N]
        const [expiringCount, expiredCount] = await Promise.all([
            this.prisma.contract.count({
                where: {
                    deletedAt: null,
                    status: activeStatus,
                    endDate: {
                        gte: ref,
                        lte: expiringEnd,
                    },
                },
            }),
            // Đã quá hạn gần đây: endDate ∈ (ref - M, ref)
            this.prisma.contract.count({
                where: {
                    deletedAt: null,
                    status: activeStatus,
                    endDate: {
                        lt: ref,
                        gte: expiredStart,
                    },
                },
            }),
        ])

        return {
            referenceDate: ref,
            expiringCount,
            expiredCount,
        }
    }

    /**
     * Lấy danh sách HĐ sắp hết hạn / đã quá hạn (chi tiết)
     * Dùng cho:
     * - Màn "Báo cáo HĐ hết/sắp hết hạn"
     * - Export Excel
     * - Gửi email (cron & resend)
     */
    async getContractExpiryList(params: ContractExpiryListParams = {}): Promise<ContractExpiryListResult> {
        const { referenceDate = new Date(), status = 'all', page = 1, pageSize = 20 } = params

        const ref = startOfDay(referenceDate)
        const expiringEnd = addDays(ref, CONTRACT_EXPIRING_IN_DAYS)
        const expiredStart = subDays(ref, CONTRACT_EXPIRED_WITHIN_DAYS)
        const activeStatus = ContractStatus.Active

        // where cho từng nhóm
        const expiringWhere = {
            deletedAt: null,
            status: activeStatus,
            endDate: {
                gte: ref,
                lte: expiringEnd,
            },
        } as const

        const expiredWhere = {
            deletedAt: null,
            status: activeStatus,
            endDate: {
                lt: ref,
                gte: expiredStart,
            },
        } as const

        // Build where tổng cho list
        let where
        if (status === 'expiring') {
            where = expiringWhere
        } else if (status === 'expired') {
            where = expiredWhere
        } else {
            // all: OR 2 khoảng
            where = {
                deletedAt: null,
                status: activeStatus,
                OR: [
                    {
                        endDate: expiringWhere.endDate,
                    },
                    {
                        endDate: expiredWhere.endDate,
                    },
                ],
            } as const
        }

        const baseInclude = {
            customer: {
                select: {
                    id: true,
                    code: true,
                    name: true,
                    taxCode: true,
                    salesOwnerEmp: {
                        select: {
                            fullName: true,
                            workEmail: true,
                        },
                    },
                    accountingOwnerEmp: {
                        select: {
                            fullName: true,
                            workEmail: true,
                        },
                    },
                },
            },
            contractType: {
                select: {
                    name: true,
                },
            },
        } as const

        const [counts, total] = await Promise.all([this.getContractExpiryCounts(ref), this.prisma.contract.count({ where })])

        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        const skip = (page - 1) * pageSize

        const contracts = await this.prisma.contract.findMany({
            where,
            include: baseInclude,
            orderBy: {
                endDate: 'asc',
            },
            skip,
            take: pageSize,
        })

        const items: ContractExpiryListItem[] = contracts.map((c) => {
            // Tự tính derivedStatus lại để chắc chắn
            let derivedStatus: 'expiring' | 'expired'
            if (c.endDate < ref) {
                derivedStatus = 'expired'
            } else {
                derivedStatus = 'expiring'
            }

            const daysToEnd = derivedStatus === 'expiring' ? diffInDays(c.endDate, ref) : undefined

            const daysSinceEnd = derivedStatus === 'expired' ? diffInDays(ref, c.endDate) : undefined

            return {
                contractId: c.id,
                contractCode: c.code,
                contractName: c.name,
                contractTypeName: c.contractType?.name ?? null,

                startDate: c.startDate,
                endDate: c.endDate,
                status: c.status,
                riskLevel: c.riskLevel,
                paymentTermDays: c.paymentTermDays ?? null,

                customerId: c.customerId ?? null,
                customerCode: c.customer?.code ?? null,
                customerName: c.customer?.name ?? null,
                customerTaxCode: c.customer?.taxCode ?? null,

                salesOwnerName: c.customer?.salesOwnerEmp?.fullName ?? null,
                salesOwnerEmail: c.customer?.salesOwnerEmp?.workEmail ?? null,
                accountingOwnerName: c.customer?.accountingOwnerEmp?.fullName ?? null,
                accountingOwnerEmail: c.customer?.accountingOwnerEmp?.workEmail ?? null,

                derivedStatus,
                daysToEnd,
                daysSinceEnd,
            }
        })

        return {
            referenceDate: ref,
            status,
            items,
            total,
            page,
            pageSize,
            totalPages,
            expiringCount: counts.expiringCount,
            expiredCount: counts.expiredCount,
        }
    }

    // TÌM HĐ SẮP HẾT HẠN / ĐÃ HẾT HẠN
    /*
    async findExpirySummary(referenceDate: Date = new Date()): Promise<ContractsExpirySummary> {
        const ref = startOfDay(referenceDate)

        const expiringThreshold = addDays(ref, CONTRACT_EXPIRING_IN_DAYS)
        const expiredThreshold = subDays(ref, CONTRACT_EXPIRED_WITHIN_DAYS)

        // Nếu enum ContractStatus khác thì sửa lại dòng này
        const activeStatus = ContractStatus.Active

        const baseInclude = {
            customer: {
                select: {
                    id: true,
                    code: true,
                    name: true,
                    taxCode: true,
                    salesOwnerEmp: {
                        select: {
                            fullName: true,
                            workEmail: true,
                        },
                    },
                    accountingOwnerEmp: {
                        select: {
                            fullName: true,
                            workEmail: true,
                        },
                    },
                },
            },
            contractType: {
                select: {
                    name: true,
                },
            },
        } as const

        // HĐ sắp hết hạn
        const expiringContracts = await this.prisma.contract.findMany({
            where: {
                deletedAt: null,
                status: activeStatus,
                endDate: {
                    gte: ref,
                    lte: expiringThreshold,
                },
            },
            include: baseInclude,
            orderBy: {
                endDate: 'asc',
            },
        })

        // HĐ đã hết hạn gần đây
        const expiredContracts = await this.prisma.contract.findMany({
            where: {
                deletedAt: null,
                status: activeStatus,
                endDate: {
                    lt: ref,
                    gte: expiredThreshold,
                },
            },
            include: baseInclude,
            orderBy: {
                endDate: 'asc',
            },
        })

        const expiring: ContractExpiryItem[] = expiringContracts.map((c) => {
            const daysToEnd = diffInDays(c.endDate, ref)

            return {
                contractId: c.id,
                customerId: c.customerId ?? null,

                contractCode: c.code,
                contractName: c.name,
                contractTypeName: c.contractType?.name ?? null,

                startDate: c.startDate,
                endDate: c.endDate,
                status: c.status,
                riskLevel: c.riskLevel,
                paymentTermDays: c.paymentTermDays ?? null,

                customerCode: c.customer?.code ?? null,
                customerName: c.customer?.name ?? null,
                customerTaxCode: c.customer?.taxCode ?? null,

                salesOwnerName: c.customer?.salesOwnerEmp?.fullName ?? null,
                salesOwnerEmail: c.customer?.salesOwnerEmp?.workEmail ?? null,
                accountingOwnerName: c.customer?.accountingOwnerEmp?.fullName ?? null,
                accountingOwnerEmail: c.customer?.accountingOwnerEmp?.workEmail ?? null,

                derivedStatus: 'expiring',
                daysToEnd,
            }
        })

        const expired: ContractExpiryItem[] = expiredContracts.map((c) => {
            const daysSinceEnd = diffInDays(ref, c.endDate)

            return {
                contractId: c.id,
                customerId: c.customerId ?? null,

                contractCode: c.code,
                contractName: c.name,
                contractTypeName: c.contractType?.name ?? null,

                startDate: c.startDate,
                endDate: c.endDate,
                status: c.status,
                riskLevel: c.riskLevel,
                paymentTermDays: c.paymentTermDays ?? null,

                customerCode: c.customer?.code ?? null,
                customerName: c.customer?.name ?? null,
                customerTaxCode: c.customer?.taxCode ?? null,

                salesOwnerName: c.customer?.salesOwnerEmp?.fullName ?? null,
                salesOwnerEmail: c.customer?.salesOwnerEmp?.workEmail ?? null,
                accountingOwnerName: c.customer?.accountingOwnerEmp?.fullName ?? null,
                accountingOwnerEmail: c.customer?.accountingOwnerEmp?.workEmail ?? null,

                derivedStatus: 'expired',
                daysSinceEnd,
            }
        })

        return {
            referenceDate: ref,
            expiring,
            expired,
        }
    }
    */
}
