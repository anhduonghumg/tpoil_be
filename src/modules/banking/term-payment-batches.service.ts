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

        const saved = this.uploadService.saveLocal(file, 'term-payment-batches')
        return this.prisma.termPaymentBatchFile.create({
            data: {
                batchId: id,
                fileType: dto.fileType ?? TermPaymentBatchFileType.OTHER,
                fileName: saved.originalName,
                fileUrl: saved.url,
                fileChecksum: saved.checksum,
                mimeType: saved.mimeType,
                sizeBytes: saved.sizeBytes,
                note: dto.note?.trim() || null,
            },
        })
    }

    async matchItem(batchId: string, itemId: string, dto: MatchTermPaymentBatchItemDto) {
        const item = await this.prisma.termPaymentBatchItem.findFirst({
            where: {
                id: itemId,
                batchId,
                status: {
                    not: TermPaymentBatchItemStatus.CANCELLED,
                },
            },
            include: {
                paymentRequest: true,
            },
        })
        if (!item) throw new NotFoundException('TERM_PAYMENT_BATCH_ITEM_NOT_FOUND')

        const txn = await this.prisma.bankTransaction.findUnique({
            where: { id: dto.bankTransactionId },
        })
        if (!txn) throw new BadRequestException('BANK_TRANSACTION_NOT_FOUND')
        if (txn.direction !== BankTxnDirection.OUT) throw new BadRequestException('ONLY_OUT_TRANSACTION_SUPPORTED')

        const paidAmount = dto.paidAmountVnd ?? Math.min(Number(txn.amount || 0), Number(item.amountVnd || 0))
        const nextStatus =
            dto.status ??
            (paidAmount + 0.0001 >= Number(item.amountVnd || 0) ? TermPaymentBatchItemStatus.PAID : TermPaymentBatchItemStatus.PARTIALLY_PAID)

        return this.prisma.$transaction(async (tx) => {
            const updated = await tx.termPaymentBatchItem.update({
                where: { id: itemId },
                data: {
                    bankTransactionId: dto.bankTransactionId,
                    paidAmountVnd: new Prisma.Decimal(paidAmount),
                    status: nextStatus,
                    note: dto.note?.trim() || item.note,
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

            const bankInstruction = await tx.purchaseTermBankInstruction.findFirst({
                where: {
                    paymentRequestId: item.paymentRequestId,
                    status: {
                        not: TermBankInstructionStatus.CANCELLED,
                    },
                },
            })

            if (bankInstruction) {
                await tx.purchaseTermBankInstruction.update({
                    where: { id: bankInstruction.id },
                    data: {
                        bankTransactionId: dto.bankTransactionId,
                        amountVnd: new Prisma.Decimal(paidAmount),
                        status: TermBankInstructionStatus.MATCHED,
                        note: dto.note?.trim() || bankInstruction.note,
                    },
                })
            } else {
                await tx.purchaseTermBankInstruction.create({
                    data: {
                    purchaseOrderId: item.purchaseOrderId,
                    paymentRequestId: item.paymentRequestId,
                    bankTransactionId: dto.bankTransactionId,
                    amountVnd: new Prisma.Decimal(paidAmount),
                    beneficiaryName: item.beneficiaryName,
                    beneficiaryBankAccount: item.beneficiaryBankAccount,
                    beneficiaryBankName: item.beneficiaryBankName,
                    content: item.transferContent,
                    status: TermBankInstructionStatus.MATCHED,
                    note: dto.note?.trim() || null,
                    },
                })
            }

            await tx.bankTransaction.update({
                where: { id: dto.bankTransactionId },
                data: {
                    matchStatus: BankTxnMatchStatus.MANUAL_MATCHED,
                    isConfirmed: true,
                    confirmedAt: new Date(),
                },
            })

            await this.refreshBatchStatus(tx, batchId)

            return updated
        })
    }
}
