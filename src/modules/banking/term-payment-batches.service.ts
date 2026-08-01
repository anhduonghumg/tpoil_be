import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import {
    BankTxnDirection,
    BankTxnMatchStatus,
    Prisma,
    TermPaymentBatchFileType,
    TermPaymentBatchItemStatus,
    TermPaymentBatchStatus,
    TermBankInstructionStatus,
    TermPaymentRequestStatus,
} from '@prisma/client'
import * as crypto from 'crypto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { UploadService } from 'src/modules/uploads/uploads.service'
import { CreateTermPaymentBatchDto, MatchTermPaymentBatchItemDto, QueryTermPaymentBatchesDto, UploadTermPaymentBatchFileDto } from './dto/term-payment-batch.dto'

@Injectable()
export class TermPaymentBatchesService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly uploadService: UploadService,
    ) {}

    private toDateOnly(value?: string | null): Date {
        if (!value) return new Date()
        return new Date(`${value}T00:00:00.000Z`)
    }

    private fileChecksum(file: Express.Multer.File) {
        const source = file.buffer
        if (!source) return null
        return crypto.createHash('sha256').update(source).digest('hex')
    }

    private period(date: Date): string {
        const year = date.getUTCFullYear()
        const month = String(date.getUTCMonth() + 1).padStart(2, '0')
        return `${year}${month}`
    }

    private async generateBatchNo(tx: Prisma.TransactionClient, batchDate: Date) {
        const period = this.period(batchDate)
        const sequence = await tx.documentSequence.upsert({
            where: {
                moduleCode_period: {
                    moduleCode: 'TERM_PAY_BATCH',
                    period,
                },
            },
            create: {
                moduleCode: 'TERM_PAY_BATCH',
                period,
                currentNo: 1,
            },
            update: {
                currentNo: {
                    increment: 1,
                },
            },
        })

        return `BKTT-${period}-${String(sequence.currentNo).padStart(4, '0')}`
    }

    private async refreshBatchStatus(tx: Prisma.TransactionClient, batchId: string) {
        const items = await tx.termPaymentBatchItem.findMany({
            where: { batchId },
        })

        const active = items.filter((x) => x.status !== TermPaymentBatchItemStatus.CANCELLED && x.status !== TermPaymentBatchItemStatus.FAILED)
        const totalAmount = active.reduce((sum, x) => sum + Number(x.amountVnd || 0), 0)
        const paidAmount = active.reduce((sum, x) => sum + Number(x.paidAmountVnd || 0), 0)

        let status: TermPaymentBatchStatus = TermPaymentBatchStatus.DRAFT
        if (active.length > 0 && active.every((x) => x.status === TermPaymentBatchItemStatus.PAID)) {
            status = TermPaymentBatchStatus.PAID
        } else if (paidAmount > 0 || active.some((x) => x.status === TermPaymentBatchItemStatus.PARTIALLY_PAID)) {
            status = TermPaymentBatchStatus.PARTIALLY_PAID
        } else if (active.some((x) => x.status === TermPaymentBatchItemStatus.SENT)) {
            status = TermPaymentBatchStatus.SENT_TO_BANK
        }

        return tx.termPaymentBatch.update({
            where: { id: batchId },
            data: {
                totalAmountVnd: new Prisma.Decimal(totalAmount),
                itemCount: active.length,
                status,
            },
        })
    }

    async listPendingPaymentRequests() {
        const requests = await this.prisma.purchaseTermPaymentRequest.findMany({
            where: {
                supplierInvoiceId: null,
                status: {
                    in: [TermPaymentRequestStatus.DRAFT, TermPaymentRequestStatus.SUBMITTED],
                },
                batchItems: {
                    none: {
                        status: {
                            in: [
                                TermPaymentBatchItemStatus.PENDING,
                                TermPaymentBatchItemStatus.SENT,
                                TermPaymentBatchItemStatus.PARTIALLY_PAID,
                                TermPaymentBatchItemStatus.PAID,
                            ],
                        },
                    },
                },
            },
            include: {
                purchaseOrder: {
                    include: {
                        supplier: true,
                    },
                },
                orderDocument: true,
            },
            orderBy: [{ requestDate: 'asc' }, { createdAt: 'asc' }],
        })

        return requests.map((item) => ({
            id: item.id,
            requestNo: item.requestNo,
            requestDate: item.requestDate,
            purchaseOrderId: item.purchaseOrderId,
            orderNo: item.purchaseOrder.orderNo,
            supplierName: item.supplierName || item.purchaseOrder.supplier?.name || null,
            amountVnd: Number(item.amountVnd || 0),
            currency: item.currency,
            paymentDeadline: item.paymentDeadline,
            content: item.content,
            status: item.status,
            createdAt: item.createdAt,
        }))
    }

    async createBatch(dto: CreateTermPaymentBatchDto) {
        const ids = [...new Set(dto.paymentRequestIds || [])]
        if (!ids.length) {
            throw new BadRequestException('TERM_PAYMENT_REQUEST_IDS_REQUIRED')
        }

        const batchDate = this.toDateOnly(dto.batchDate)

        return this.prisma.$transaction(async (tx) => {
            if (dto.bankAccountId) {
                const bankAccount = await tx.bankAccount.findUnique({ where: { id: dto.bankAccountId } })
                if (!bankAccount) throw new BadRequestException('BANK_ACCOUNT_NOT_FOUND')
            }

            const requests = await tx.purchaseTermPaymentRequest.findMany({
                where: {
                    id: { in: ids },
                    supplierInvoiceId: null,
                    status: { in: [TermPaymentRequestStatus.DRAFT, TermPaymentRequestStatus.SUBMITTED] },
                },
                include: {
                    purchaseOrder: {
                        include: {
                            supplier: true,
                        },
                    },
                    batchItems: {
                        where: {
                            status: {
                                in: [
                                    TermPaymentBatchItemStatus.PENDING,
                                    TermPaymentBatchItemStatus.SENT,
                                    TermPaymentBatchItemStatus.PARTIALLY_PAID,
                                    TermPaymentBatchItemStatus.PAID,
                                ],
                            },
                        },
                    },
                },
            })

            if (requests.length !== ids.length) {
                throw new BadRequestException('TERM_PAYMENT_REQUEST_NOT_FOUND_OR_CANCELLED')
            }

            const used = requests.find((x) => x.batchItems.length > 0)
            if (used) {
                throw new BadRequestException(`TERM_PAYMENT_REQUEST_ALREADY_IN_BATCH:${used.requestNo}`)
            }

            const total = requests.reduce((sum, x) => sum + Number(x.amountVnd || 0), 0)
            const batchNo = await this.generateBatchNo(tx, batchDate)

            const batch = await tx.termPaymentBatch.create({
                data: {
                    batchNo,
                    batchDate,
                    bankAccountId: dto.bankAccountId ?? null,
                    totalAmountVnd: new Prisma.Decimal(total),
                    itemCount: requests.length,
                    status: TermPaymentBatchStatus.DRAFT,
                    note: dto.note?.trim() || null,
                    items: {
                        create: requests.map((request) => ({
                            paymentRequestId: request.id,
                            purchaseOrderId: request.purchaseOrderId,
                            supplierName: request.supplierName || request.purchaseOrder.supplier?.name || '',
                            amountVnd: request.amountVnd,
                            paidAmountVnd: new Prisma.Decimal(0),
                            beneficiaryName: request.supplierName || request.purchaseOrder.supplier?.name || null,
                            transferContent: request.content || `Thanh toán ${request.requestNo}`,
                            status: TermPaymentBatchItemStatus.PENDING,
                        })),
                    },
                },
                include: {
                    items: true,
                    files: true,
                    bankAccount: true,
                },
            })

            await tx.purchaseTermPaymentRequest.updateMany({
                where: { id: { in: ids } },
                data: { status: TermPaymentRequestStatus.IN_BATCH },
            })

            return batch
        })
    }

    async listBatches(query: QueryTermPaymentBatchesDto) {
        const page = Number(query.page || 1)
        const pageSize = Number(query.pageSize || 20)
        const skip = (page - 1) * pageSize

        const where: Prisma.TermPaymentBatchWhereInput = {
            ...(query.status ? { status: query.status } : {}),
            ...(query.bankAccountId ? { bankAccountId: query.bankAccountId } : {}),
            ...(query.keyword?.trim()
                ? {
                      OR: [
                          { batchNo: { contains: query.keyword.trim(), mode: 'insensitive' } },
                          { note: { contains: query.keyword.trim(), mode: 'insensitive' } },
                          { items: { some: { supplierName: { contains: query.keyword.trim(), mode: 'insensitive' } } } },
                      ],
                  }
                : {}),
        }

        const [items, total] = await this.prisma.$transaction([
            this.prisma.termPaymentBatch.findMany({
                where,
                skip,
                take: pageSize,
                orderBy: [{ batchDate: 'desc' }, { createdAt: 'desc' }],
                include: {
                    bankAccount: true,
                    items: true,
                    files: true,
                },
            }),
            this.prisma.termPaymentBatch.count({ where }),
        ])

        return {
            items,
            total,
            page,
            pageSize,
        }
    }

    async detail(id: string) {
        const batch = await this.prisma.termPaymentBatch.findUnique({
            where: { id },
            include: {
                bankAccount: true,
                files: true,
                items: {
                    include: {
                        paymentRequest: true,
                        purchaseOrder: {
                            include: {
                                supplier: true,
                            },
                        },
                        bankTransaction: true,
                    },
                    orderBy: { createdAt: 'asc' },
                },
            },
        })

        if (!batch) throw new NotFoundException('TERM_PAYMENT_BATCH_NOT_FOUND')
        return batch
    }

    async markSent(id: string) {
        const batch = await this.prisma.termPaymentBatch.findUnique({
            where: { id },
            include: { items: true },
        })
        if (!batch) throw new NotFoundException('TERM_PAYMENT_BATCH_NOT_FOUND')
        if (batch.status === TermPaymentBatchStatus.CANCELLED) throw new BadRequestException('TERM_PAYMENT_BATCH_CANCELLED')

        return this.prisma.$transaction(async (tx) => {
            await tx.termPaymentBatchItem.updateMany({
                where: {
                    batchId: id,
                    status: TermPaymentBatchItemStatus.PENDING,
                },
                data: {
                    status: TermPaymentBatchItemStatus.SENT,
                },
            })

            await tx.termPaymentBatch.update({
                where: { id },
                data: {
                    status: TermPaymentBatchStatus.SENT_TO_BANK,
                },
            })

            const paymentRequestIds = batch.items.map((item) => item.paymentRequestId)
            await tx.purchaseTermPaymentRequest.updateMany({
                where: { id: { in: paymentRequestIds } },
                data: {
                    status: TermPaymentRequestStatus.SENT_TO_BANK,
                },
            })

            return tx.termPaymentBatch.findUniqueOrThrow({
                where: { id },
                include: {
                    bankAccount: true,
                    items: true,
                    files: true,
                },
            })
        })
    }

    async uploadFile(id: string, file: Express.Multer.File, dto: UploadTermPaymentBatchFileDto) {
        const batch = await this.prisma.termPaymentBatch.findUnique({
            where: { id },
        })
        if (!batch) throw new NotFoundException('TERM_PAYMENT_BATCH_NOT_FOUND')
        if (!file) throw new BadRequestException('FILE_REQUIRED')

        const fileType = dto.fileType ?? TermPaymentBatchFileType.OTHER
        if (fileType !== TermPaymentBatchFileType.EXPORTED_LIST && fileType !== TermPaymentBatchFileType.UNC) {
            throw new BadRequestException('TERM_PAYMENT_BATCH_FILE_TYPE_NOT_ALLOWED')
        }

        const existingFiles = await this.prisma.termPaymentBatchFile.findMany({
            where: { batchId: id },
            orderBy: { createdAt: 'asc' },
        })

        const checksum = this.fileChecksum(file)
        const sameFile = checksum ? existingFiles.find((item) => item.fileChecksum === checksum) : null
        if (sameFile) {
            return sameFile
        }

        const sameType = existingFiles.find((item) => item.fileType === fileType)
        const uncFileCount = existingFiles.filter((item) => item.fileType === TermPaymentBatchFileType.UNC).length
        if (fileType === TermPaymentBatchFileType.UNC && uncFileCount >= 3) {
            throw new BadRequestException('TERM_PAYMENT_BATCH_MAX_3_UNC_FILES')
        }

        const saved = this.uploadService.saveLocal(file, 'term-payment-batches')
        const data = {
            fileType,
            fileName: saved.originalName,
            fileUrl: saved.url,
            fileChecksum: saved.checksum ?? checksum,
            mimeType: saved.mimeType,
            sizeBytes: saved.sizeBytes,
            note: dto.note?.trim() || null,
        }

        if (fileType === TermPaymentBatchFileType.EXPORTED_LIST && sameType) {
            const updated = await this.prisma.termPaymentBatchFile.update({
                where: { id: sameType.id },
                data,
            })
            await this.uploadService.deleteByUrls([sameType.fileUrl])
            return updated
        }

        return this.prisma.termPaymentBatchFile.create({
            data: {
                batchId: id,
                ...data,
            },
        })
    }

    async matchItem(batchId: string, itemId: string, dto: MatchTermPaymentBatchItemDto) {
        const item = await this.prisma.termPaymentBatchItem.findFirst({
            where: {
                id: itemId,
                batchId,
                status: {
                    notIn: [TermPaymentBatchItemStatus.CANCELLED, TermPaymentBatchItemStatus.FAILED],
                },
            },
            include: {
                paymentRequest: true,
            },
        })
        if (!item) throw new NotFoundException('TERM_PAYMENT_BATCH_ITEM_NOT_FOUND')
        if (item.status === TermPaymentBatchItemStatus.PAID) throw new BadRequestException('TERM_PAYMENT_BATCH_ITEM_ALREADY_PAID')

        const uncFile = await this.prisma.termPaymentBatchFile.findFirst({
            where: {
                batchId,
                fileType: TermPaymentBatchFileType.UNC,
            },
            select: { id: true },
        })
        if (!uncFile) throw new BadRequestException('TERM_PAYMENT_UNC_FILE_REQUIRED')

        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id: dto.bankTransactionId },
        })
        if (!txn) throw new BadRequestException('BANK_TRANSACTION_NOT_FOUND')
        if (txn.direction !== BankTxnDirection.OUT) throw new BadRequestException('ONLY_OUT_TRANSACTION_SUPPORTED')
        if (txn.isConfirmed || txn.matchStatus !== BankTxnMatchStatus.UNMATCHED) {
            throw new BadRequestException('BANK_TRANSACTION_ALREADY_MATCHED')
        }

        const usedTxn = await this.prisma.purchaseTermBankInstruction.findFirst({
            where: {
                bankTransactionId: dto.bankTransactionId,
                status: {
                    not: TermBankInstructionStatus.CANCELLED,
                },
            },
            select: { id: true },
        })
        if (usedTxn) throw new BadRequestException('BANK_TRANSACTION_ALREADY_USED_FOR_TERM_PAYMENT')

        return this.prisma.$transaction(async (tx) => {
            const matchedAggregate = await tx.purchaseTermBankInstruction.aggregate({
                where: {
                    paymentRequestId: item.paymentRequestId,
                    bankTransactionId: {
                        not: null,
                    },
                    status: {
                        not: TermBankInstructionStatus.CANCELLED,
                    },
                },
                _sum: {
                    amountVnd: true,
                },
            })

            const requiredAmount = Number(item.amountVnd || 0)
            const previousMatchedAmount = Number(matchedAggregate._sum.amountVnd || 0)
            const remainingAmount = Math.max(requiredAmount - previousMatchedAmount, 0)
            if (remainingAmount <= 0) {
                throw new BadRequestException('TERM_PAYMENT_REQUEST_ALREADY_MATCHED')
            }

            const matchedAmount = dto.paidAmountVnd ?? Math.min(Number(txn.amount || 0), remainingAmount)
            if (matchedAmount <= 0) {
                throw new BadRequestException('TERM_PAYMENT_AMOUNT_INVALID')
            }

            await tx.purchaseTermBankInstruction.create({
                data: {
                    purchaseOrderId: item.purchaseOrderId,
                    paymentRequestId: item.paymentRequestId,
                    bankTransactionId: dto.bankTransactionId,
                    instructionNo: txn.externalRef ?? null,
                    instructionDate: txn.txnDate,
                    amountVnd: new Prisma.Decimal(matchedAmount),
                    beneficiaryName: item.beneficiaryName,
                    beneficiaryBankAccount: item.beneficiaryBankAccount,
                    beneficiaryBankName: item.beneficiaryBankName,
                    content: item.transferContent,
                    status: TermBankInstructionStatus.SENT,
                    note: dto.note?.trim() || null,
                },
            })

            const updated = await tx.termPaymentBatchItem.update({
                where: { id: itemId },
                data: {
                    bankTransactionId: dto.bankTransactionId,
                    status: item.status === TermPaymentBatchItemStatus.PENDING ? TermPaymentBatchItemStatus.SENT : item.status,
                    note: dto.note?.trim() || item.note,
                },
            })

            await tx.bankTransaction.update({
                where: { id: dto.bankTransactionId },
                data: {
                    matchStatus: BankTxnMatchStatus.MANUAL_MATCHED,
                },
            })

            await this.refreshBatchStatus(tx, batchId)

            return updated
        })
    }

    async confirmItemPaid(batchId: string, itemId: string) {
        const item = await this.prisma.termPaymentBatchItem.findFirst({
            where: {
                id: itemId,
                batchId,
                status: {
                    notIn: [TermPaymentBatchItemStatus.CANCELLED, TermPaymentBatchItemStatus.FAILED],
                },
            },
            include: {
                paymentRequest: true,
            },
        })
        if (!item) throw new NotFoundException('TERM_PAYMENT_BATCH_ITEM_NOT_FOUND')
        if (item.status === TermPaymentBatchItemStatus.PAID) throw new BadRequestException('TERM_PAYMENT_BATCH_ITEM_ALREADY_PAID')

        return this.prisma.$transaction(async (tx) => {
            const instructions = await tx.purchaseTermBankInstruction.findMany({
                where: {
                    paymentRequestId: item.paymentRequestId,
                    bankTransactionId: {
                        not: null,
                    },
                    status: {
                        in: [TermBankInstructionStatus.SENT, TermBankInstructionStatus.MATCHED],
                    },
                },
                select: {
                    id: true,
                    bankTransactionId: true,
                    amountVnd: true,
                },
            })

            if (!instructions.length) {
                throw new BadRequestException('TERM_PAYMENT_MATCHED_TRANSACTION_REQUIRED')
            }

            const totalPaidAmount = instructions.reduce((sum, instruction) => sum + Number(instruction.amountVnd || 0), 0)
            const requiredAmount = Number(item.amountVnd || 0)
            const nextStatus =
                totalPaidAmount + 0.0001 >= requiredAmount ? TermPaymentBatchItemStatus.PAID : TermPaymentBatchItemStatus.PARTIALLY_PAID

            await tx.purchaseTermBankInstruction.updateMany({
                where: {
                    id: {
                        in: instructions.map((instruction) => instruction.id),
                    },
                },
                data: {
                    status: TermBankInstructionStatus.MATCHED,
                },
            })

            const bankTransactionIds = instructions.map((instruction) => instruction.bankTransactionId).filter((id): id is string => !!id)
            if (bankTransactionIds.length) {
                await tx.bankTransaction.updateMany({
                    where: {
                        id: {
                            in: bankTransactionIds,
                        },
                    },
                    data: {
                        matchStatus: BankTxnMatchStatus.MANUAL_MATCHED,
                        isConfirmed: true,
                        confirmedAt: new Date(),
                    },
                })
            }

            const updated = await tx.termPaymentBatchItem.update({
                where: { id: itemId },
                data: {
                    paidAmountVnd: new Prisma.Decimal(totalPaidAmount),
                    status: nextStatus,
                },
            })

            await tx.purchaseTermPaymentRequest.update({
                where: { id: item.paymentRequestId },
                data: {
                    status:
                        nextStatus === TermPaymentBatchItemStatus.PAID
                            ? TermPaymentRequestStatus.PAID
                            : TermPaymentRequestStatus.PARTIALLY_PAID,
                },
            })

            await this.refreshBatchStatus(tx, batchId)

            return updated
        })
    }
}
