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
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'
import { ImportContractsDto, ImportContractsResult, ImportContractsResultItem } from './dto/import-contracts.dto'
import dayjs from 'dayjs'

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

                if (dto.customerId && origin.customerId && dto.customerId !== origin.customerId) {
                    throw new BadRequestException('Gia hạn phải cùng khách hàng với hợp đồng gốc')
                }

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

            if (oldRenewalOfId && oldRenewalOfId !== newRenewalOfId) {
                const hasOtherRenewals = await tx.contract.findFirst({
                    where: {
                        renewalOfId: oldRenewalOfId,
                        id: { not: id },
                    },
                })

                if (!hasOtherRenewals) {
                    await tx.contract.update({
                        where: { id: oldRenewalOfId },
                        data: { status: ContractStatus.Active },
                    })
                }
            }

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

        let where
        if (status === 'expiring') {
            where = expiringWhere
        } else if (status === 'expired') {
            where = expiredWhere
        } else {
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

        // console.log('listAttachableContracts data:', items)

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

    /**
     * Import hợp đồng từ Excel
     * - Map customerCode -> customerId
     * - Map contractTypeCode -> contractTypeId
     * - Map renewalOfCode -> contractId
     * - Tạo HĐ mới
     * - Nếu có renewalOfId -> tự động set status = Terminated cho HĐ gốc
     */
    async importFromExcel(dto: ImportContractsDto): Promise<ImportContractsResult> {
        const rows = dto.rows ?? []

        if (!rows.length) {
            return {
                total: 0,
                successCount: 0,
                failureCount: 0,
                items: [],
            }
        }

        // ===== 1. Chuẩn bị dữ liệu lookup (code -> entity) =====
        const customerCodes = Array.from(new Set(rows.map((r) => r.customerCode).filter(Boolean)))
        const contractTypeCodes = Array.from(new Set(rows.map((r) => r.contractTypeCode).filter(Boolean)))
        const renewalCodes = Array.from(new Set(rows.map((r) => r.renewalOfCode).filter((c): c is string => !!c && c.trim().length > 0)))

        const [customers, contractTypes, originContracts] = await Promise.all([
            this.prisma.customer.findMany({
                where: { code: { in: customerCodes } },
                select: { id: true, code: true },
            }),
            this.prisma.contractType.findMany({
                where: { code: { in: contractTypeCodes } },
                select: { id: true, code: true },
            }),
            renewalCodes.length
                ? this.prisma.contract.findMany({
                      where: { code: { in: renewalCodes } },
                      select: { id: true, code: true, status: true },
                  })
                : Promise.resolve([] as { id: string; code: string; status: string }[]),
        ])

        const customerMap = new Map(customers.map((c) => [c.code, c]))
        const contractTypeMap = new Map(contractTypes.map((t) => [t.code, t]))
        const originContractMap = new Map<string, string>()
        originContracts.forEach((c) => {
            originContractMap.set(c.code, c.id)
        })

        // ===== 2. Helper parse date =====
        const parseDate = (value: string): Date | null => {
            if (!value) return null

            const trimmed = value.trim()

            // Thử DD/MM/YYYY
            let d = dayjs(trimmed, 'DD/MM/YYYY', true)
            if (d.isValid()) return d.toDate()

            // Thử YYYY-MM-DD
            d = dayjs(trimmed, 'YYYY-MM-DD', true)
            if (d.isValid()) return d.toDate()

            return null
        }

        const resultItems: ImportContractsResultItem[] = []

        const validPayloads: {
            rowIndex: number
            code: string
            data: Prisma.ContractUncheckedCreateInput
            originContractId?: string // để auto Terminated
        }[] = []

        // ===== 3. Validate từng dòng & build payload =====
        rows.forEach((row, index) => {
            const rowLabel = row.code || `row-${index + 1}`

            const errors: string[] = []

            const customer = customerMap.get(row.customerCode)
            if (!customer) {
                errors.push(`Không tìm thấy khách hàng với mã: ${row.customerCode}`)
            }

            const contractType = contractTypeMap.get(row.contractTypeCode)
            if (!contractType) {
                errors.push(`Không tìm thấy loại hợp đồng với mã: ${row.contractTypeCode}`)
            }

            const startDate = parseDate(row.startDate)
            const endDate = parseDate(row.endDate)
            if (!startDate) errors.push(`Ngày bắt đầu không hợp lệ: ${row.startDate}`)
            if (!endDate) errors.push(`Ngày kết thúc không hợp lệ: ${row.endDate}`)
            if (startDate && endDate && endDate < startDate) {
                errors.push('Ngày kết thúc phải >= ngày bắt đầu')
            }

            let originContractId: string | undefined = undefined
            if (row.renewalOfCode) {
                const originId = originContractMap.get(row.renewalOfCode)
                if (!originId) {
                    errors.push(`Không tìm thấy hợp đồng gốc với mã: ${row.renewalOfCode}`)
                } else {
                    originContractId = originId
                }
            }

            if (errors.length) {
                resultItems.push({
                    index,
                    code: rowLabel,
                    success: false,
                    error: errors.join('; '),
                })
                return
            }

            // Build payload cho Prisma
            const data: Prisma.ContractUncheckedCreateInput = {
                customerId: customer!.id,
                contractTypeId: contractType!.id,
                code: row.code,
                name: row.name,
                startDate: startDate!,
                endDate: endDate!,
                status: row.status,
                paymentTermDays: typeof row.paymentTermDays === 'number' ? row.paymentTermDays : null,
                creditLimitOverride: typeof row.creditLimitOverride === 'number' ? row.creditLimitOverride : null,
                riskLevel: row.riskLevel,
                sla: row.sla ?? undefined,
                deliveryScope: row.deliveryScope ?? undefined,
                renewalOfId: originContractId ?? null,
                approvalRequestId: null,
            }

            validPayloads.push({
                rowIndex: index,
                code: row.code,
                data,
                originContractId,
            })
        })

        if (!validPayloads.length) {
            const failureCount = resultItems.length
            return {
                total: rows.length,
                successCount: 0,
                failureCount,
                items: resultItems,
            }
        }

        // ===== 4. Ghi DB trong transaction =====
        const createdResults = await this.prisma.$transaction(async (tx) => {
            const items: ImportContractsResultItem[] = [...resultItems]

            for (const payload of validPayloads) {
                try {
                    const created = await tx.contract.create({
                        data: payload.data,
                    })

                    if (payload.originContractId) {
                        await tx.contract.update({
                            where: { id: payload.originContractId },
                            data: { status: 'Terminated' },
                        })
                    }

                    items.push({
                        index: payload.rowIndex,
                        code: payload.code,
                        success: true,
                    })
                } catch (e: any) {
                    items.push({
                        index: payload.rowIndex,
                        code: payload.code,
                        success: false,
                        error: e?.message || 'Lỗi không xác định khi ghi DB',
                    })
                }
            }

            return items
        })

        const successCount = createdResults.filter((i) => i.success).length
        const failureCount = createdResults.filter((i) => !i.success).length

        const result: ImportContractsResult = {
            total: rows.length,
            successCount,
            failureCount,
            items: createdResults,
        }

        return result
    }

    async generateImportTemplate(): Promise<Buffer> {
        const workbook = new ExcelJS.Workbook()

        const sheet = workbook.addWorksheet('Nhập hợp đồng')

        sheet.columns = [
            { header: 'Mã HĐ', key: 'code', width: 18 },
            { header: 'Tên hợp đồng', key: 'name', width: 40 },
            { header: 'Mã KH', key: 'customerCode', width: 18 },
            { header: 'Mã loại HĐ', key: 'contractTypeCode', width: 18 },
            { header: 'Ngày bắt đầu', key: 'startDate', width: 20 },
            { header: 'Ngày kết thúc', key: 'endDate', width: 20 },
            { header: 'Trạng thái', key: 'status', width: 20 },
            { header: 'Kỳ thanh toán (ngày)', key: 'paymentTermDays', width: 22 },
            { header: 'Hạn mức tín dụng override', key: 'creditLimitOverride', width: 26 },
            { header: 'Rủi ro', key: 'riskLevel', width: 16 },
            { header: 'SLA', key: 'sla', width: 30 },
            { header: 'Phạm vi giao hàng', key: 'deliveryScope', width: 30 },
            { header: 'Mã HĐ gốc (gia hạn)', key: 'renewalOfCode', width: 24 },
        ]

        sheet.getRow(1).font = { bold: true }

        // Ví dụ 1
        sheet.addRow({
            code: 'HD-2025-001',
            name: 'Hợp đồng cung cấp xăng dầu năm 2025',
            customerCode: 'CUST001',
            contractTypeCode: 'TERM',
            startDate: '01/01/2025',
            endDate: '31/12/2025',
            status: 'Active',
            paymentTermDays: 30,
            creditLimitOverride: 1000000000,
            riskLevel: 'Medium',
            sla: '{"deliveryTime":"24h","support":"24/7"}',
            deliveryScope: '{"region":"Miền Bắc"}',
            renewalOfCode: '',
        })

        // Ví dụ 2
        sheet.addRow({
            code: 'HD-2025-002',
            name: 'Hợp đồng khung phân phối dầu DO',
            customerCode: 'CUST002',
            contractTypeCode: 'FRAME',
            startDate: '2025-02-01',
            endDate: '2026-01-31',
            status: 'Draft',
            paymentTermDays: 45,
            creditLimitOverride: '',
            riskLevel: 'High',
            sla: '',
            deliveryScope: '',
            renewalOfCode: 'HD-2024-010',
        })

        const guide = workbook.addWorksheet('Hướng dẫn')
        guide.addRow(['Các cột bắt buộc:', 'Mã HĐ', 'Tên hợp đồng', 'Mã KH', 'Mã loại HĐ', 'Ngày bắt đầu', 'Ngày kết thúc', 'Trạng thái', 'Rủi ro'])
        guide.addRow([])
        guide.addRow(['Trạng thái hợp lệ:', 'Draft', 'Pending', 'Active', 'Terminated', 'Cancelled'])
        guide.addRow(['Rủi ro hợp lệ:', 'Low', 'Medium', 'High'])
        guide.addRow([])
        guide.addRow(['Lưu ý:'])
        guide.addRow(['- Ngày hỗ trợ 2 dạng: DD/MM/YYYY hoặc YYYY-MM-DD.'])
        guide.addRow(['- "Mã HĐ gốc (gia hạn)" là mã hợp đồng cũ nếu đây là hợp đồng gia hạn, hệ thống sẽ tự set Terminated cho HĐ gốc.'])
        guide.addRow(['- Nếu không dùng hạn mức override, để trống "Hạn mức tín dụng override".'])

        const data = await workbook.xlsx.writeBuffer()
        return Buffer.from(data)
    }
}
