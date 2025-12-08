import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { ContractStatus, Prisma } from '@prisma/client'
import { AssignContractsToCustomerDto } from '../customers/dto/assign-contracts.dto'
import { AssignCustomerToContractDto } from './dto/assign-customer.dto'
import { addDays, diffInDays, startOfDay, subDays, formatDate } from 'src/common/utils/date.utils'
import { CONTRACT_EXPIRED_WITHIN_DAYS, CONTRACT_EXPIRING_IN_DAYS } from 'src/common/constants/constants'
import { ContractExpiryCounts, ContractExpiryListItem, ContractExpiryListParams, ContractExpiryListResult } from './contracts-expiry.types'
import * as ExcelJS from 'exceljs'
import { ContractExpiryEmailDto } from './dto/contract-expiry-email.dto'
import { MailService } from 'src/mail/mail.service'
// import { UnassignContractsDto } from '../customers/dto/unassign-contracts.dto'
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'

@Injectable()
export class ContractsService {
    constructor(
        private prisma: PrismaService,
        private readonly mailService: MailService,
    ) {}

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
                        throw new ConflictException(`Hợp đồng đã được gán cho khách hàng khác ${o.code} (${o.startDate.toISOString()} – ${o.endDate.toISOString()})`)
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
                    code: e?.name || 'không xác định',
                    reason: e?.message || 'Lỗi Không xác định',
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
    async unassignContractsFromCustomer(customerId: string, contractIds: string[]) {
        const customer = await this.getCustomerOrThrow(customerId)

        const assigned: string[] = []
        const failed: { contractId: string; code: string; reason: string }[] = []

        for (const contractId of contractIds) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const contract = await tx.contract.findUnique({
                        where: { id: contractId },
                    })

                    if (!contract || contract.deletedAt) {
                        throw new NotFoundException('Không tìm thấy hợp đồng')
                    }

                    if (contract.customerId !== customer.id) {
                        throw new BadRequestException('Hợp đồng không thuộc khách hàng này')
                    }

                    if (contract.status === ContractStatus.Cancelled) {
                        throw new BadRequestException('Không thể gỡ hợp đồng đã hủy')
                    }

                    await tx.contract.update({
                        where: { id: contract.id },
                        data: { customerId: null },
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
                    renewalOf: { select: { id: true, code: true } },
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
            renewalOfId: c.renewalOfId ?? null,
            renewalOfCode: c.renewalOf?.code ?? null,
        }))

        return { items, total, page, pageSize }
    }

    // CREATE
    // async create(dto: CreateContractDto) {
    //     return this.prisma.contract.create({
    //         data: {
    //             code: dto.code,
    //             name: dto.name,
    //             startDate: new Date(dto.startDate),
    //             endDate: new Date(dto.endDate),
    //             status: dto.status,
    //             paymentTermDays: dto.paymentTermDays,
    //             creditLimitOverride: dto.creditLimitOverride,
    //             sla: dto.sla,
    //             deliveryScope: dto.deliveryScope,
    //             riskLevel: dto.riskLevel,
    //             approvalRequestId: dto.approvalRequestId,
    //             customer: dto.customerId ? { connect: { id: dto.customerId } } : undefined,
    //             contractType: { connect: { id: dto.contractTypeId } },
    //             renewalOf: dto.renewalOfId ? { connect: { id: dto.renewalOfId } } : undefined,
    //         },
    //     })
    // }

    async create(dto: CreateContractDto) {
        return this.prisma.$transaction(async (tx) => {
            let origin: { id: string; customerId: string | null; endDate: Date } | null = null

            if (dto.renewalOfId) {
                origin = await tx.contract.findUnique({
                    where: { id: dto.renewalOfId },
                    select: { id: true, customerId: true, endDate: true },
                })

                if (!origin) {
                    throw new NotFoundException('Hợp đồng gốc không tồn tại')
                }

                // check cùng customer nếu cả hai đều có customerId
                if (dto.customerId && origin.customerId && dto.customerId !== origin.customerId) {
                    throw new BadRequestException('Gia hạn phải cùng khách hàng với hợp đồng gốc')
                }

                // check không chồng ngày: yêu cầu startDate mới > endDate cũ
                const newStart = new Date(dto.startDate)
                if (newStart <= origin.endDate) {
                    throw new BadRequestException('Ngày bắt đầu của hợp đồng gia hạn phải sau ngày kết thúc của hợp đồng gốc')
                }
            }

            const newContract = await tx.contract.create({
                data: {
                    customerId: dto.customerId ?? null,
                    contractTypeId: dto.contractTypeId,
                    code: dto.code,
                    name: dto.name,
                    startDate: new Date(dto.startDate),
                    endDate: new Date(dto.endDate),
                    status: dto.status ?? ContractStatus.Active,
                    paymentTermDays: dto.paymentTermDays ?? null,
                    creditLimitOverride: dto.creditLimitOverride ?? null,
                    riskLevel: dto.riskLevel,
                    sla: dto.sla ?? null,
                    deliveryScope: dto.deliveryScope ?? null,
                    renewalOfId: dto.renewalOfId ?? null,
                    approvalRequestId: dto.approvalRequestId ?? null,
                },
            })

            // Nếu là gia hạn -> tự động kết thúc HĐ gốc
            if (origin) {
                await tx.contract.update({
                    where: { id: origin.id },
                    data: { status: ContractStatus.Terminated },
                })
            }

            return newContract
        })
    }

    async createAttachment(dto: CreateContractAttachmentDto) {
        // check quyền, check contractId tồn tại...
        return this.prisma.contractAttachment.create({
            data: {
                contractId: dto.contractId,
                fileName: dto.fileName,
                fileUrl: dto.fileUrl,
                category: dto.category ?? null,
                externalUrl: dto.externalUrl ?? null,
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
    // async update(id: string, dto: UpdateContractDto) {
    //     const existing = await this.prisma.contract.findFirst({
    //         where: { id, deletedAt: null },
    //     })
    //     if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng')

    //     return this.prisma.contract.update({
    //         where: { id },
    //         data: {
    //             code: dto.code ?? undefined,
    //             name: dto.name ?? undefined,
    //             startDate: dto.startDate ? new Date(dto.startDate) : undefined,
    //             endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    //             status: dto.status ?? undefined,
    //             paymentTermDays: dto.paymentTermDays,
    //             creditLimitOverride: dto.creditLimitOverride !== undefined ? dto.creditLimitOverride : undefined,
    //             sla: dto.sla,
    //             deliveryScope: dto.deliveryScope,
    //             riskLevel: dto.riskLevel,
    //             approvalRequestId: dto.approvalRequestId,
    //             customer: dto.customerId ? { connect: { id: dto.customerId } } : dto.customerId === null ? { disconnect: true } : undefined,
    //             contractType: dto.contractTypeId ? { connect: { id: dto.contractTypeId } } : undefined,
    //             renewalOf: dto.renewalOfId ? { connect: { id: dto.renewalOfId } } : dto.renewalOfId === null ? { disconnect: true } : undefined,
    //         },
    //     })
    // }

    async update(id: string, dto: UpdateContractDto) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.contract.findUnique({
                where: { id },
            })

            if (!existing) {
                throw new NotFoundException('Contract not found')
            }

            const oldRenewalOfId = existing.renewalOfId
            const newRenewalOfId = dto.renewalOfId ?? null

            const newCustomerId = dto.customerId ?? existing.customerId
            const newStartDate = dto.startDate ?? existing.startDate
            // const newEndDate = dto.endDate ?? existing.endDate

            // ===== 1. Nếu có HĐ gốc mới -> validate & Terminate gốc mới =====
            if (newRenewalOfId) {
                const newOrigin = await tx.contract.findUnique({
                    where: { id: newRenewalOfId },
                })
                if (!newOrigin) {
                    throw new NotFoundException('Origin contract not found')
                }

                if (newOrigin.customerId !== newCustomerId) {
                    throw new BadRequestException('Renewal must be within the same customer')
                }

                const startDate = new Date(newStartDate)
                const originEnd = new Date(newOrigin.endDate)
                if (startDate <= originEnd) {
                    throw new BadRequestException('New contract startDate must be after origin endDate')
                }

                // Đặt HĐ gốc mới sang Terminated
                await tx.contract.update({
                    where: { id: newOrigin.id },
                    data: { status: ContractStatus.Terminated },
                })
            }

            // ===== 2. Nếu đổi HĐ gốc / bỏ gia hạn -> có thể re-open HĐ gốc cũ =====
            if (oldRenewalOfId && oldRenewalOfId !== newRenewalOfId) {
                const hasOtherRenewals = await tx.contract.findFirst({
                    where: {
                        renewalOfId: oldRenewalOfId,
                        id: { not: id },
                    },
                })

                if (!hasOtherRenewals) {
                    // Nếu không còn HĐ con nào khác, mở lại HĐ gốc cũ
                    await tx.contract.update({
                        where: { id: oldRenewalOfId },
                        data: { status: ContractStatus.Active },
                    })
                }
            }

            // ===== 3. Update chính HĐ này =====
            const updated = await tx.contract.update({
                where: { id },
                data: {
                    customerId: newCustomerId,
                    contractTypeId: dto.contractTypeId ?? existing.contractTypeId,
                    code: dto.code ?? existing.code,
                    name: dto.name ?? existing.name,
                    startDate: dto.startDate ? new Date(dto.startDate) : undefined,
                    endDate: dto.endDate ? new Date(dto.endDate) : undefined,
                    status: dto.status ?? existing.status,
                    paymentTermDays: dto.paymentTermDays !== undefined ? dto.paymentTermDays : existing.paymentTermDays,
                    creditLimitOverride: dto.creditLimitOverride !== undefined ? dto.creditLimitOverride : existing.creditLimitOverride,
                    riskLevel: dto.riskLevel ?? existing.riskLevel,
                    sla: dto.sla ?? existing.sla,
                    deliveryScope: dto.deliveryScope ?? existing.deliveryScope,
                    renewalOfId: newRenewalOfId,
                    approvalRequestId: dto.approvalRequestId ?? existing.approvalRequestId,
                },
            })

            if (updated.renewalOfId && updated.status === 'Active') {
                await tx.contract.update({
                    where: { id: updated.renewalOfId },
                    data: { status: 'Terminated' },
                })
            }

            return updated
        })
    }

    // REMOVE
    // async remove(id: string) {
    //     const existing = await this.prisma.contract.findFirst({
    //         where: { id, deletedAt: null },
    //     })
    //     if (!existing) throw new NotFoundException('Không tìm thấy hợp đồng')

    //     return this.prisma.contract.update({
    //         where: { id },
    //         data: { deletedAt: new Date() },
    //     })
    // }

    async remove(id: string) {
        return this.prisma.$transaction(async (tx) => {
            const existing = await tx.contract.findUnique({
                where: { id },
            })

            if (!existing) {
                throw new NotFoundException('Contract not found')
            }

            const originId = existing.renewalOfId

            await tx.contractAttachment.deleteMany({
                where: { contractId: id },
            })

            await tx.contract.delete({
                where: { id },
            })

            if (originId) {
                const hasOtherRenewals = await tx.contract.findFirst({
                    where: {
                        renewalOfId: originId,
                    },
                })

                if (!hasOtherRenewals) {
                    await tx.contract.update({
                        where: { id: originId },
                        data: { status: ContractStatus.Active },
                    })
                }
            }

            return { success: true }
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
        let { referenceDate, status = 'all', page = 1, pageSize = 20 } = params
        if (!referenceDate) {
            referenceDate = new Date()
        } else if (typeof referenceDate === 'string') {
            referenceDate = new Date(referenceDate)
        }

        if (!(referenceDate instanceof Date) || isNaN(referenceDate.getTime())) {
            throw new BadRequestException('Invalid referenceDate')
        }

        page = Number(page) || 1
        pageSize = Number(pageSize) || 20

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

        // console.log('status', status)
        // console.log('Contract expiry list generated with:', items)

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
    async generateContractExpiryExcel(params: ContractExpiryListParams = {}) {
        // Lấy full list, bỏ paging (hoặc cho pageSize rất lớn)
        const result = await this.getContractExpiryList({
            ...params,
            page: 1,
            pageSize: 10_000,
        })

        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Expiry Report')

        sheet.columns = [
            { header: 'Mã HĐ', key: 'contractCode', width: 18 },
            { header: 'Tên hợp đồng', key: 'contractName', width: 40 },
            { header: 'Khách hàng', key: 'customerName', width: 30 },
            { header: 'Loại HĐ', key: 'contractTypeName', width: 18 },
            { header: 'Ngày hiệu lực', key: 'startDate', width: 15 },
            { header: 'Ngày hết hạn', key: 'endDate', width: 15 },
            { header: 'Trạng thái hạn', key: 'derivedStatusLabel', width: 18 },
            { header: 'Sales phụ trách', key: 'salesOwnerName', width: 25 },
            { header: 'Kế toán phụ trách', key: 'accountingOwnerName', width: 25 },
        ]

        for (const item of result.items) {
            sheet.addRow({
                contractCode: item.contractCode,
                contractName: item.contractName,
                customerName: item.customerName,
                contractTypeName: item.contractTypeName,
                startDate: formatDate(item.startDate),
                endDate: formatDate(item.endDate),
                derivedStatusLabel:
                    item.derivedStatus === 'expiring'
                        ? `Sắp hết hạn${item.daysToEnd != null ? ` (${item.daysToEnd} ngày nữa)` : ''}`
                        : `Đã quá hạn${item.daysSinceEnd != null ? ` (${item.daysSinceEnd} ngày)` : ''}`,
                salesOwnerName: item.salesOwnerName,
                accountingOwnerName: item.accountingOwnerName,
            })
        }

        const buffer = await workbook.xlsx.writeBuffer()
        return { buffer, result }
    }

    async sendContractExpiryEmail(payload: ContractExpiryEmailDto) {
        const { referenceDate, status = 'all', to, cc = [], replyTo } = payload

        // 1. Tạo báo cáo + file Excel
        const { buffer, result } = await this.generateContractExpiryExcel({
            referenceDate,
            status,
        })

        const refDateLabel = referenceDate ? formatDate(typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate) : formatDate(new Date())

        // 2. Lấy danh sách customerId trong report
        const customerIds = Array.from(new Set(result.items.map((x) => x.customerId).filter((x): x is string => !!x)))

        // 3. Query Email người phụ trách (sales + kế toán)
        let ownerEmails: string[] = []
        if (customerIds.length) {
            const owners = await this.prisma.customer.findMany({
                where: { id: { in: customerIds } },
                select: {
                    salesOwnerEmp: { select: { workEmail: true } },
                    accountingOwnerEmp: { select: { workEmail: true } },
                },
            })

            ownerEmails = owners.flatMap((o) => [o.salesOwnerEmp?.workEmail, o.accountingOwnerEmp?.workEmail]).filter((e): e is string => !!e)
        }

        const mergedCc = Array.from(new Set<string>([...cc, ...ownerEmails])).filter((e) => !to.includes(e))
        const subject = `Báo cáo hợp đồng sắp/đã hết hạn - ngày ${refDateLabel}`
        const text = `Ngày ${refDateLabel}: Có ${result.expiringCount} hợp đồng sắp hết hạn, ${result.expiredCount} hợp đồng đã quá hạn.\nChi tiết xem file đính kèm.`

        const html = `
                    <p>Chào anh/chị,</p>
                    <p>Ngày <b>${refDateLabel}</b>:</p>
                    <ul>
                        <li><b>${result.expiringCount}</b> hợp đồng sắp hết hạn</li>
                        <li><b>${result.expiredCount}</b> hợp đồng đã quá hạn</li>
                    </ul>
                    <p>Chi tiết xem file Excel đính kèm.</p>
                    `

        await this.mailService.sendMail({
            to,
            cc: mergedCc,
            replyTo,
            subject,
            text,
            html,
            attachments: [
                {
                    filename: `Bao_cao_hop_dong_het_han_${refDateLabel}.xlsx`,
                    content: buffer as any,
                    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                },
            ],
        })

        return {
            sentTo: to,
            cc: mergedCc,
            summary: {
                referenceDate: result.referenceDate,
                expiringCount: result.expiringCount,
                expiredCount: result.expiredCount,
            },
        }
    }

    async listByCustomer(customerId: string) {
        return this.prisma.contract.findMany({
            where: { customerId, deletedAt: null },
            orderBy: { startDate: 'desc' },
            select: {
                id: true,
                code: true,
                name: true,
                startDate: true,
                endDate: true,
                status: true,
                riskLevel: true,
            },
        })
    }

    async listAttachableContracts(params: { customerId: string; keyword?: string; page?: number; pageSize?: number }) {
        const { keyword = '', page = 1, pageSize = 20 } = params

        const where: any = {
            deletedAt: null,
            customerId: null,
        }

        if (keyword) {
            where.OR = [{ code: { contains: keyword, mode: 'insensitive' } }, { name: { contains: keyword, mode: 'insensitive' } }]
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.contract.findMany({
                where,
                orderBy: { startDate: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    code: true,
                    name: true,
                    startDate: true,
                    endDate: true,
                    status: true,
                    riskLevel: true,
                    contractType: { select: { name: true } },
                },
            }),
            this.prisma.contract.count({ where }),
        ])

        console.log('listAttachableContracts data:', items)

        return { items, total, page, pageSize }
    }

    async attachContracts(customerId: string, contractIds: string[]) {
        if (!contractIds.length) return { updated: 0 }

        const rs = await this.prisma.contract.updateMany({
            where: {
                id: { in: contractIds },
                deletedAt: null,
                customerId: null,
            },
            data: { customerId },
        })

        return { updated: rs.count }
    }
}
