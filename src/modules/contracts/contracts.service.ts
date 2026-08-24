import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateContractDto } from './dto/create-contract.dto'
import { UpdateContractDto } from './dto/update-contract.dto'
import { ContractListQueryDto } from './dto/contract-list-query.dto'
import { ContractKind, ContractStatus, Prisma } from '@prisma/client'
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
import { DocumentStorageService } from '../uploads/document-storage.service'
import { UploadService } from '../uploads/uploads.service'

/**
 * Loại hợp đồng mà chiều luôn là MUA, bất kể người nhập chọn gì: mình đi thuê kho thì
 * không có chiều bán nào cả.
 *
 * HDMBXD ("hợp đồng mua bán xăng dầu") KHÔNG nằm ở đây: cùng một loại được dùng cả khi
 * mình mua của PVOIL lẫn khi mình bán cho khách, nên chiều phải do người nhập quyết.
 */
const ALWAYS_PURCHASE_CONTRACT_TYPE_CODES = new Set(['WAREHOUSE_RENTAL'])

@Injectable()
export class ContractsService {
    constructor(
        private prisma: PrismaService,
        private readonly mailService: MailService,
        private readonly documentStorage: DocumentStorageService,
        private readonly uploadService: UploadService,
    ) {}

    private async getContractOrThrow(contractId: string) {
        const contract = await this.prisma.contract.findUnique({
            where: { id: contractId },
        })

        if (!contract || contract.deletedAt) {
            throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng')
        }

        return contract
    }

    private async getCustomerOrThrow(customerId: string) {
        const customer = await this.prisma.party.findFirst({
            where: { id: customerId, deletedAt: null },
        })

        if (!customer) {
            throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng')
        }

        return customer
    }

    private async isWarehouseRentalContractType(tx: Prisma.TransactionClient | PrismaService, contractTypeId: string) {
        const type = await tx.contractType.findFirst({
            where: { id: contractTypeId, deletedAt: null },
            select: { code: true },
        })
        if (!type) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y loáº¡i há»£p Ä‘á»“ng')
        return type.code === 'WAREHOUSE_RENTAL'
    }

    private async isPurchaseContractType(tx: Prisma.TransactionClient | PrismaService, contractTypeId: string) {
        const type = await tx.contractType.findFirst({
            where: { id: contractTypeId, deletedAt: null },
            select: { code: true },
        })
        if (!type) throw new NotFoundException('Không tìm thấy loại hợp đồng')
        return ALWAYS_PURCHASE_CONTRACT_TYPE_CODES.has(type.code)
    }

    private async replaceWarehouseRentalLinks(tx: Prisma.TransactionClient, contractId: string, warehouseIds: string[]) {
        const uniqueWarehouseIds = [...new Set(warehouseIds)]
        if (uniqueWarehouseIds.length) {
            const warehouses = await tx.warehouse.findMany({
                where: { id: { in: uniqueWarehouseIds } },
                select: { id: true },
            })
            if (warehouses.length !== uniqueWarehouseIds.length) {
                throw new BadRequestException('CÃ³ kho khÃ´ng tá»“n táº¡i hoáº·c Ä‘Ã£ bá»‹ xÃ³a')
            }
        }
        await tx.warehouseRentalContractLink.deleteMany({ where: { contractId } })
        if (uniqueWarehouseIds.length) {
            await tx.warehouseRentalContractLink.createMany({
                data: uniqueWarehouseIds.map((warehouseId) => ({ contractId, warehouseId })),
            })
        }
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
            throw new BadRequestException('KhÃ´ng thá»ƒ gÃ¡n há»£p Ä‘á»“ng Ä‘Ã£ há»§y')
        }

        // HÄ Ä‘Ã£ gÃ¡n KH khÃ¡c rá»“i
        if (contract.customerId && contract.customerId !== customer.id) {
            throw new ConflictException('Há»£p Ä‘á»“ng Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n cho khÃ¡ch hÃ ng khÃ¡c')
        }

        // Check trÃ¹ng thá»i gian vá»›i cÃ¡c HÄ khÃ¡c cá»§a KH nÃ y
        const overlaps = await this.findOverlapsForCustomer({
            customerId: customer.id,
            startDate: contract.startDate,
            endDate: contract.endDate,
            excludeContractId: contract.id,
        })

        if (overlaps.length > 0) {
            const o = overlaps[0]
            throw new ConflictException(`Thá»i gian há»£p Ä‘á»“ng trÃ¹ng vá»›i ${o.code} (${o.startDate.toISOString()} â€“ ${o.endDate.toISOString()})`)
        }

        const updated = await this.prisma.contract.update({
            where: { id: contract.id },
            data: { customerId: customer.id },
        })

        return updated
    }

    /**
     * N HÄ â†’ 1 KH (mÃ n Customer: gÃ¡n nhiá»u há»£p Ä‘á»“ng cho 1 khÃ¡ch)
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
                        throw new BadRequestException('KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng')
                    }

                    if (contract.status === ContractStatus.Cancelled) {
                        throw new BadRequestException('KhÃ´ng thá»ƒ gÃ¡n há»£p Ä‘á»“ng Ä‘Ã£ há»§y')
                    }

                    if (contract.customerId && contract.customerId !== customer.id) {
                        throw new ConflictException('Há»£p Ä‘á»“ng Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n cho khÃ¡ch hÃ ng khÃ¡c')
                    }

                    const overlaps = await this.findOverlapsForCustomer({
                        customerId: customer.id,
                        startDate: contract.startDate,
                        endDate: contract.endDate,
                        excludeContractId: contract.id,
                    })

                    if (overlaps.length > 0) {
                        const o = overlaps[0]
                        throw new ConflictException(`Há»£p Ä‘á»“ng Ä‘Ã£ Ä‘Æ°á»£c gÃ¡n cho khÃ¡ch hÃ ng khÃ¡c ${o.code} (${o.startDate.toISOString()} â€“ ${o.endDate.toISOString()})`)
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
                    code: e?.name || 'khÃ´ng xÃ¡c Ä‘á»‹nh',
                    reason: e?.message || 'Lá»—i KhÃ´ng xÃ¡c Ä‘á»‹nh',
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
     * Gá»¡ gÃ¡n 1 HÄ khá»i 1 KH (mÃ n Customer)
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
                        throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng')
                    }

                    if (contract.customerId !== customer.id) {
                        throw new BadRequestException('Há»£p Ä‘á»“ng khÃ´ng thuá»™c khÃ¡ch hÃ ng nÃ y')
                    }

                    if (contract.status === ContractStatus.Cancelled) {
                        throw new BadRequestException('KhÃ´ng thá»ƒ gá»¡ há»£p Ä‘á»“ng Ä‘Ã£ há»§y')
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
        const { keyword, customerId, contractTypeId, kind, status, riskLevel, startFrom, startTo, endFrom, endTo, page = 1, pageSize = 20 } = query

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
            ...(contractTypeId ? { contractTypeId } : {}),
            // Bán hay mua: workspace nào chỉ nhìn hợp đồng của chiều đó.
            ...(kind ? { kind } : {}),
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
                            category: true,
                        },
                    },
                    renewalOf: { select: { id: true, code: true } },
                    warehouseRentalLinks: { select: { warehouse: { select: { id: true, code: true, name: true } } } },
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
            warehouses: c.warehouseRentalLinks.map((link) => link.warehouse),
        }))

        return { items, total, page, pageSize }
    }

    async create(dto: CreateContractDto) {
        return this.prisma.$transaction(async (tx) => {
            const isWarehouseRental = await this.isWarehouseRentalContractType(tx, dto.contractTypeId)
            const isPurchaseContract = await this.isPurchaseContractType(tx, dto.contractTypeId)
            if (dto.warehouseIds !== undefined && !isWarehouseRental) {
                throw new BadRequestException('Chá»‰ há»£p Ä‘á»“ng thuÃª kho má»›i Ä‘Æ°á»£c phÃ©p gÃ¡n kho')
            }
            if (isWarehouseRental && !dto.warehouseIds?.length) {
                throw new BadRequestException('Há»£p Ä‘á»“ng thuÃª kho cáº§n gÃ¡n Ã­t nháº¥t má»™t kho')
            }
            let origin: { id: string; customerId: string | null; endDate: Date } | null = null

            if (dto.renewalOfId) {
                origin = await tx.contract.findUnique({
                    where: { id: dto.renewalOfId },
                    select: { id: true, customerId: true, endDate: true },
                })

                if (!origin) {
                    throw new NotFoundException('Há»£p Ä‘á»“ng gá»‘c khÃ´ng tá»“n táº¡i')
                }

                if (dto.customerId && origin.customerId && dto.customerId !== origin.customerId) {
                    throw new BadRequestException('Gia háº¡n pháº£i cÃ¹ng khÃ¡ch hÃ ng vá»›i há»£p Ä‘á»“ng gá»‘c')
                }

                const newStart = new Date(dto.startDate)
                if (newStart <= origin.endDate) {
                    throw new BadRequestException('NgÃ y báº¯t Ä‘áº§u cá»§a há»£p Ä‘á»“ng gia háº¡n pháº£i sau ngÃ y káº¿t thÃºc cá»§a há»£p Ä‘á»“ng gá»‘c')
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
                    kind: isPurchaseContract ? ContractKind.PURCHASE : dto.kind ?? ContractKind.SALES,
                },
            })

            if (isWarehouseRental && dto.warehouseIds) {
                await this.replaceWarehouseRentalLinks(tx, newContract.id, dto.warehouseIds)
            }

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
                warehouseRentalLinks: { include: { warehouse: { select: { id: true, code: true, name: true } } } },
            },
        })

        if (!contract) throw new NotFoundException('KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng')
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

            const contractTypeId = dto.contractTypeId ?? existing.contractTypeId
            const isWarehouseRental = await this.isWarehouseRentalContractType(tx, contractTypeId)
            const isPurchaseContract = await this.isPurchaseContractType(tx, contractTypeId)
            if (dto.warehouseIds !== undefined && !isWarehouseRental) {
                throw new BadRequestException('Chá»‰ há»£p Ä‘á»“ng thuÃª kho má»›i Ä‘Æ°á»£c phÃ©p gÃ¡n kho')
            }
            if (isWarehouseRental && dto.warehouseIds !== undefined && !dto.warehouseIds.length) {
                throw new BadRequestException('Há»£p Ä‘á»“ng thuÃª kho cáº§n gÃ¡n Ã­t nháº¥t má»™t kho')
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

                // Äáº·t HÄ gá»‘c má»›i sang Terminated
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
                    kind: isPurchaseContract ? ContractKind.PURCHASE : dto.kind ?? existing.kind,
                },
            })

            if (isWarehouseRental && dto.warehouseIds !== undefined) {
                await this.replaceWarehouseRentalLinks(tx, id, dto.warehouseIds)
            }

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
        const attachments = await this.prisma.contractAttachment.findMany({
            where: { contractId: id },
            select: { fileUrl: true },
        })
        const fileUrls = attachments.map((item) => item.fileUrl).filter((url): url is string => Boolean(url))

        const result = await this.prisma.$transaction(async (tx) => {
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

        // Storage cleanup runs after the database transaction so a failed delete never removes a live reference.
        const driveUrls = fileUrls.filter((url) => this.documentStorage.fileIdFromUrl(url))
        const localUrls = fileUrls.filter((url) => !this.documentStorage.fileIdFromUrl(url))
        const [driveCleanup, localCleanup] = await Promise.all([
            this.documentStorage.deleteByUrls(driveUrls),
            this.uploadService.deleteByUrls(localUrls),
        ])

        return {
            ...result,
            fileCleanup: {
                deleted: driveCleanup.deleted + localCleanup.deleted,
                failed: [...driveCleanup.failed, ...localCleanup.failed],
            },
        }
    }

    /**
     * Äáº¿m sá»‘ HÄ sáº¯p háº¿t háº¡n / Ä‘Ã£ quÃ¡ háº¡n táº¡i 1 ngÃ y tham chiáº¿u.
     * DÃ¹ng cho:
     * - Bell (bootstrap)
     * - Summary cá»§a mÃ n bÃ¡o cÃ¡o
     */

    async getContractExpiryCounts(referenceDate: Date = new Date()): Promise<ContractExpiryCounts> {
        const ref = startOfDay(referenceDate)

        const expiringEnd = addDays(ref, CONTRACT_EXPIRING_IN_DAYS)
        const expiredStart = subDays(ref, CONTRACT_EXPIRED_WITHIN_DAYS)

        const activeStatus = ContractStatus.Active

        // Sáº¯p háº¿t háº¡n: endDate âˆˆ [ref, ref + N]
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
            // ÄÃ£ quÃ¡ háº¡n gáº§n Ä‘Ã¢y: endDate âˆˆ (ref - M, ref)
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
     * Láº¥y danh sÃ¡ch HÄ sáº¯p háº¿t háº¡n / Ä‘Ã£ quÃ¡ háº¡n (chi tiáº¿t)
     * DÃ¹ng cho:
     * - MÃ n "BÃ¡o cÃ¡o HÄ háº¿t/sáº¯p háº¿t háº¡n"
     * - Export Excel
     * - Gá»­i email (cron & resend)
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

        // where cho tá»«ng nhÃ³m
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

    // TÃŒM HÄ Sáº®P Háº¾T Háº N / ÄÃƒ Háº¾T Háº N
    async generateContractExpiryExcel(params: ContractExpiryListParams = {}) {
        const result = await this.getContractExpiryList({
            ...params,
            page: 1,
            pageSize: 10_000,
        })

        const workbook = new ExcelJS.Workbook()
        const sheet = workbook.addWorksheet('Expiry Report')

        sheet.columns = [
            { header: 'MÃ£ HÄ', key: 'contractCode', width: 18 },
            { header: 'TÃªn há»£p Ä‘á»“ng', key: 'contractName', width: 40 },
            { header: 'KhÃ¡ch hÃ ng', key: 'customerName', width: 30 },
            { header: 'Loáº¡i HÄ', key: 'contractTypeName', width: 18 },
            { header: 'NgÃ y hiá»‡u lá»±c', key: 'startDate', width: 15 },
            { header: 'NgÃ y háº¿t háº¡n', key: 'endDate', width: 15 },
            { header: 'Tráº¡ng thÃ¡i háº¡n', key: 'derivedStatusLabel', width: 18 },
            { header: 'Sales phá»¥ trÃ¡ch', key: 'salesOwnerName', width: 25 },
            { header: 'Káº¿ toÃ¡n phá»¥ trÃ¡ch', key: 'accountingOwnerName', width: 25 },
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
                        ? `Sáº¯p háº¿t háº¡n${item.daysToEnd != null ? ` (${item.daysToEnd} ngÃ y ná»¯a)` : ''}`
                        : `ÄÃ£ quÃ¡ háº¡n${item.daysSinceEnd != null ? ` (${item.daysSinceEnd} ngÃ y)` : ''}`,
                salesOwnerName: item.salesOwnerName,
                accountingOwnerName: item.accountingOwnerName,
            })
        }

        const buffer = await workbook.xlsx.writeBuffer()
        return { buffer, result }
    }

    async sendContractExpiryEmail(payload: ContractExpiryEmailDto) {
        const { referenceDate, status = 'all', to, cc = [], replyTo } = payload

        // 1. Táº¡o bÃ¡o cÃ¡o + file Excel
        const { buffer, result } = await this.generateContractExpiryExcel({
            referenceDate,
            status,
        })

        const refDateLabel = referenceDate ? formatDate(typeof referenceDate === 'string' ? new Date(referenceDate) : referenceDate) : formatDate(new Date())

        // 2. Láº¥y danh sÃ¡ch customerId trong report
        const customerIds = Array.from(new Set(result.items.map((x) => x.customerId).filter((x): x is string => !!x)))

        // 3. Query Email ngÆ°á»i phá»¥ trÃ¡ch (sales + káº¿ toÃ¡n)
        let ownerEmails: string[] = []
        if (customerIds.length) {
            const owners = await this.prisma.party.findMany({
                where: { id: { in: customerIds } },
                select: {
                    salesOwnerEmp: { select: { workEmail: true } },
                    accountingOwnerEmp: { select: { workEmail: true } },
                },
            })

            ownerEmails = owners.flatMap((o) => [o.salesOwnerEmp?.workEmail, o.accountingOwnerEmp?.workEmail]).filter((e): e is string => !!e)
        }

        const mergedCc = Array.from(new Set<string>([...cc, ...ownerEmails])).filter((e) => !to.includes(e))
        const subject = `BÃ¡o cÃ¡o há»£p Ä‘á»“ng sáº¯p/Ä‘Ã£ háº¿t háº¡n - ngÃ y ${refDateLabel}`
        const text = `NgÃ y ${refDateLabel}: CÃ³ ${result.expiringCount} há»£p Ä‘á»“ng sáº¯p háº¿t háº¡n, ${result.expiredCount} há»£p Ä‘á»“ng Ä‘Ã£ quÃ¡ háº¡n.\nChi tiáº¿t xem file Ä‘Ã­nh kÃ¨m.`

        const html = `
                    <p>ChÃ o anh/chá»‹,</p>
                    <p>NgÃ y <b>${refDateLabel}</b>:</p>
                    <ul>
                        <li><b>${result.expiringCount}</b> há»£p Ä‘á»“ng sáº¯p háº¿t háº¡n</li>
                        <li><b>${result.expiredCount}</b> há»£p Ä‘á»“ng Ä‘Ã£ quÃ¡ háº¡n</li>
                    </ul>
                    <p>Chi tiáº¿t xem file Excel Ä‘Ã­nh kÃ¨m.</p>
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
     * Import há»£p Ä‘á»“ng tá»« Excel
     * - Map customerCode -> customerId
     * - Map contractTypeCode -> contractTypeId
     * - Map renewalOfCode -> contractId
     * - Táº¡o HÄ má»›i
     * - Náº¿u cÃ³ renewalOfId -> tá»± Ä‘á»™ng set status = Terminated cho HÄ gá»‘c
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

        // ===== 1. Chuáº©n bá»‹ dá»¯ liá»‡u lookup (code -> entity) =====
        const customerCodes = Array.from(new Set(rows.map((r) => r.customerCode).filter(Boolean)))
        const contractTypeCodes = Array.from(new Set(rows.map((r) => r.contractTypeCode).filter(Boolean)))
        const renewalCodes = Array.from(new Set(rows.map((r) => r.renewalOfCode).filter((c): c is string => !!c && c.trim().length > 0)))

        const [customers, contractTypes, originContracts] = await Promise.all([
            this.prisma.party.findMany({
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

            // Thá»­ DD/MM/YYYY
            let d = dayjs(trimmed, 'DD/MM/YYYY', true)
            if (d.isValid()) return d.toDate()

            // Thá»­ YYYY-MM-DD
            d = dayjs(trimmed, 'YYYY-MM-DD', true)
            if (d.isValid()) return d.toDate()

            return null
        }

        const resultItems: ImportContractsResultItem[] = []

        const validPayloads: {
            rowIndex: number
            code: string
            data: Prisma.ContractUncheckedCreateInput
            originContractId?: string // Ä‘á»ƒ auto Terminated
        }[] = []

        // ===== 3. Validate tá»«ng dÃ²ng & build payload =====
        rows.forEach((row, index) => {
            const rowLabel = row.code || `row-${index + 1}`

            const errors: string[] = []

            const customer = customerMap.get(row.customerCode)
            if (!customer) {
                errors.push(`KhÃ´ng tÃ¬m tháº¥y khÃ¡ch hÃ ng vá»›i mÃ£: ${row.customerCode}`)
            }

            const contractType = contractTypeMap.get(row.contractTypeCode)
            if (!contractType) {
                errors.push(`KhÃ´ng tÃ¬m tháº¥y loáº¡i há»£p Ä‘á»“ng vá»›i mÃ£: ${row.contractTypeCode}`)
            }

            const startDate = parseDate(row.startDate)
            const endDate = parseDate(row.endDate)
            if (!startDate) errors.push(`NgÃ y báº¯t Ä‘áº§u khÃ´ng há»£p lá»‡: ${row.startDate}`)
            if (!endDate) errors.push(`NgÃ y káº¿t thÃºc khÃ´ng há»£p lá»‡: ${row.endDate}`)
            if (startDate && endDate && endDate < startDate) {
                errors.push('NgÃ y káº¿t thÃºc pháº£i >= ngÃ y báº¯t Ä‘áº§u')
            }

            let originContractId: string | undefined = undefined
            if (row.renewalOfCode) {
                const originId = originContractMap.get(row.renewalOfCode)
                if (!originId) {
                    errors.push(`KhÃ´ng tÃ¬m tháº¥y há»£p Ä‘á»“ng gá»‘c vá»›i mÃ£: ${row.renewalOfCode}`)
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
                        error: e?.message || 'Lá»—i khÃ´ng xÃ¡c Ä‘á»‹nh khi ghi DB',
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

        const sheet = workbook.addWorksheet('Nháº­p há»£p Ä‘á»“ng')

        sheet.columns = [
            { header: 'MÃ£ HÄ', key: 'code', width: 18 },
            { header: 'TÃªn há»£p Ä‘á»“ng', key: 'name', width: 40 },
            { header: 'MÃ£ KH', key: 'customerCode', width: 18 },
            { header: 'MÃ£ loáº¡i HÄ', key: 'contractTypeCode', width: 18 },
            { header: 'NgÃ y báº¯t Ä‘áº§u', key: 'startDate', width: 20 },
            { header: 'NgÃ y káº¿t thÃºc', key: 'endDate', width: 20 },
            { header: 'Tráº¡ng thÃ¡i', key: 'status', width: 20 },
            { header: 'Ká»³ thanh toÃ¡n (ngÃ y)', key: 'paymentTermDays', width: 22 },
            { header: 'Háº¡n má»©c tÃ­n dá»¥ng override', key: 'creditLimitOverride', width: 26 },
            { header: 'Rá»§i ro', key: 'riskLevel', width: 16 },
            { header: 'SLA', key: 'sla', width: 30 },
            { header: 'Pháº¡m vi giao hÃ ng', key: 'deliveryScope', width: 30 },
            { header: 'MÃ£ HÄ gá»‘c (gia háº¡n)', key: 'renewalOfCode', width: 24 },
        ]

        sheet.getRow(1).font = { bold: true }

        // VÃ­ dá»¥ 1
        sheet.addRow({
            code: 'HD-2025-001',
            name: 'Há»£p Ä‘á»“ng cung cáº¥p xÄƒng dáº§u nÄƒm 2025',
            customerCode: 'CUST001',
            contractTypeCode: 'TERM',
            startDate: '01/01/2025',
            endDate: '31/12/2025',
            status: 'Active',
            paymentTermDays: 30,
            creditLimitOverride: 1000000000,
            riskLevel: 'Medium',
            sla: '{"deliveryTime":"24h","support":"24/7"}',
            deliveryScope: '{"region":"Miá»n Báº¯c"}',
            renewalOfCode: '',
        })

        // VÃ­ dá»¥ 2
        sheet.addRow({
            code: 'HD-2025-002',
            name: 'Há»£p Ä‘á»“ng khung phÃ¢n phá»‘i dáº§u DO',
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

        const guide = workbook.addWorksheet('HÆ°á»›ng dáº«n')
        guide.addRow(['CÃ¡c cá»™t báº¯t buá»™c:', 'MÃ£ HÄ', 'TÃªn há»£p Ä‘á»“ng', 'MÃ£ KH', 'MÃ£ loáº¡i HÄ', 'NgÃ y báº¯t Ä‘áº§u', 'NgÃ y káº¿t thÃºc', 'Tráº¡ng thÃ¡i', 'Rá»§i ro'])
        guide.addRow([])
        guide.addRow(['Tráº¡ng thÃ¡i há»£p lá»‡:', 'Draft', 'Pending', 'Active', 'Terminated', 'Cancelled'])
        guide.addRow(['Rá»§i ro há»£p lá»‡:', 'Low', 'Medium', 'High'])
        guide.addRow([])
        guide.addRow(['LÆ°u Ã½:'])
        guide.addRow(['- NgÃ y há»— trá»£ 2 dáº¡ng: DD/MM/YYYY hoáº·c YYYY-MM-DD.'])
        guide.addRow(['- "MÃ£ HÄ gá»‘c (gia háº¡n)" lÃ  mÃ£ há»£p Ä‘á»“ng cÅ© náº¿u Ä‘Ã¢y lÃ  há»£p Ä‘á»“ng gia háº¡n, há»‡ thá»‘ng sáº½ tá»± set Terminated cho HÄ gá»‘c.'])
        guide.addRow(['- Náº¿u khÃ´ng dÃ¹ng háº¡n má»©c override, Ä‘á»ƒ trá»‘ng "Háº¡n má»©c tÃ­n dá»¥ng override".'])

        const data = await workbook.xlsx.writeBuffer()
        return Buffer.from(data)
    }
}
