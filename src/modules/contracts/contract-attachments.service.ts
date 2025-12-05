import { Injectable, NotFoundException } from '@nestjs/common'
import { CreateContractAttachmentDto } from './dto/create-contract-attachment.dto'
import { UpdateContractAttachmentDto } from './dto/update-contract-attachment.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class ContractAttachmentsService {
    constructor(private prisma: PrismaService) {}

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
        return this.prisma.contractAttachment.delete({ where: { id } })
        // const att = await this.prisma.contractAttachment.findUnique(...)
        // await prisma.contractAttachment.delete(...)
        // await uploadService.deleteByUrl(att.fileUrl)
    }
}
