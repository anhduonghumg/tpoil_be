import { Injectable, NotFoundException } from '@nestjs/common'
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'
import { UpdateContractAttachmentDto } from './dto/update-contract-attachment.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { DocumentStorageService } from '../uploads/document-storage.service'
import { UploadService } from '../uploads/uploads.service'

@Injectable()
export class ContractAttachmentsService {
    constructor(
        private prisma: PrismaService,
        private readonly documentStorage: DocumentStorageService,
        private readonly uploadService: UploadService,
    ) {}

    async listByContract(contractId: string) {
        return this.prisma.contractAttachment.findMany({
            where: { contractId },
        })
    }

    async create(dto: CreateContractAttachmentDto) {
        return this.prisma.contractAttachment.create({
            data: {
                fileName: dto.fileName,
                fileUrl: dto.fileUrl,
                externalUrl: dto.externalUrl,
                category: dto.category,
                contract: { connect: { id: dto.contractId } },
            },
        })
    }

    async update(id: string, dto: UpdateContractAttachmentDto) {
        const existing = await this.prisma.contractAttachment.findUnique({
            where: { id },
        })

        if (!existing) throw new NotFoundException('Attachment not found')

        return this.prisma.contractAttachment.update({
            where: { id },
            data: dto,
        })
    }

    async delete(id: string) {
        const attachment = await this.prisma.contractAttachment.findUnique({ where: { id } })
        if (!attachment) throw new NotFoundException('Attachment not found')

        const deleted = await this.prisma.contractAttachment.delete({ where: { id } })
        if (attachment.fileUrl) {
            if (this.documentStorage.fileIdFromUrl(attachment.fileUrl)) {
                await this.documentStorage.deleteByUrls([attachment.fileUrl])
            } else {
                await this.uploadService.deleteByUrls([attachment.fileUrl])
            }
        }
        return deleted
    }
}
