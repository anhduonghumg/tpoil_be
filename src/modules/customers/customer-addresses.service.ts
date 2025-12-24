// customers/customer-addresses.service.ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CustomerAddress } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto'
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto'

@Injectable()
export class CustomerAddressesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(customerId: string): Promise<CustomerAddress[]> {
        return this.prisma.customerAddress.findMany({
            where: { customerId },
            orderBy: { validFrom: 'desc' },
        })
    }

    async create(customerId: string, dto: CreateCustomerAddressDto): Promise<CustomerAddress> {
        const validFrom = this.toDateOnly(dto.validFrom)

        return this.prisma.$transaction(async (tx): Promise<CustomerAddress> => {
            const customer = await tx.customer.findFirst({
                where: { id: customerId, deletedAt: null },
                select: { id: true },
            })
            if (!customer) throw new NotFoundException('Không tìm thấy khách hàng')

            const overlap = await tx.customerAddress.findFirst({
                where: {
                    customerId,
                    validFrom: { lt: validFrom },
                    OR: [{ validTo: null }, { validTo: { gt: validFrom } }],
                },
                select: { id: true },
            })
            if (overlap) throw new BadRequestException('Khoảng thời gian địa chỉ bị chồng lấn')

            await tx.customerAddress.updateMany({
                where: { customerId, validTo: null },
                data: { validTo: validFrom },
            })

            return tx.customerAddress.create({
                data: {
                    customerId,
                    addressLine: dto.addressLine.trim(),
                    validFrom,
                    note: dto.note?.trim(),
                },
            })
        })
    }

    async update(addressId: string, dto: UpdateCustomerAddressDto): Promise<CustomerAddress> {
        const existing = await this.prisma.customerAddress.findUnique({
            where: { id: addressId },
            select: { id: true, customerId: true, validFrom: true, validTo: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy địa chỉ')

        const nextValidFrom = dto.validFrom ? this.toDateOnly(dto.validFrom) : existing.validFrom

        if (dto.validFrom) {
            const overlap = await this.prisma.customerAddress.findFirst({
                where: {
                    customerId: existing.customerId,
                    id: { not: addressId },
                    validFrom: { lt: nextValidFrom },
                    OR: [{ validTo: null }, { validTo: { gt: nextValidFrom } }],
                },
                select: { id: true },
            })
            if (overlap) throw new BadRequestException('Khoảng thời gian địa chỉ bị chồng lấn')
        }

        return this.prisma.customerAddress.update({
            where: { id: addressId },
            data: {
                addressLine: dto.addressLine?.trim(),
                validFrom: dto.validFrom ? nextValidFrom : undefined,
                note: dto.note?.trim(),
            },
        })
    }

    async remove(addressId: string): Promise<CustomerAddress> {
        const existing = await this.prisma.customerAddress.findUnique({
            where: { id: addressId },
            select: { id: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy địa chỉ')

        return this.prisma.customerAddress.delete({ where: { id: addressId } })
    }

    async getAddressAt(customerId: string, atDate: Date): Promise<CustomerAddress | null> {
        const d = this.toDateOnly(atDate)

        return this.prisma.customerAddress.findFirst({
            where: {
                customerId,
                validFrom: { lte: d },
                OR: [{ validTo: null }, { validTo: { gt: d } }],
            },
            orderBy: { validFrom: 'desc' },
        })
    }

    private toDateOnly(d: Date): Date {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
    }
}
