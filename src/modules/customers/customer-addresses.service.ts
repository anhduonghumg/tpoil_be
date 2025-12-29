import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import type { CustomerAddress, Prisma } from '@prisma/client'
import { PrismaService } from 'src/infra/prisma/prisma.service'
import { CreateCustomerAddressDto } from './dto/create-customer-address.dto'
import { UpdateCustomerAddressDto } from './dto/update-customer-address.dto'

@Injectable()
export class CustomerAddressesService {
    constructor(private readonly prisma: PrismaService) {}

    async list(customerId: string): Promise<CustomerAddress[]> {
        const customer = await this.prisma.customer.findFirst({
            where: { id: customerId, deletedAt: null },
            select: { id: true },
        })
        if (!customer) throw new NotFoundException('Không tìm thấy khách hàng')

        return this.prisma.customerAddress.findMany({
            where: { customerId },
            orderBy: { validFrom: 'desc' },
        })
    }

    async create(customerId: string, dto: CreateCustomerAddressDto): Promise<CustomerAddress> {
        const newFrom = this.toDateOnly(dto.validFrom)
        const addressLine = dto.addressLine.trim()
        const note = dto.note?.trim()

        if (!addressLine) throw new BadRequestException('Địa chỉ không được để trống')

        return this.prisma.$transaction(async (tx) => {
            const customer = await tx.customer.findFirst({
                where: { id: customerId, deletedAt: null },
                select: { id: true },
            })
            if (!customer) throw new NotFoundException('Không tìm thấy khách hàng')

            const current = await tx.customerAddress.findFirst({
                where: { customerId, validTo: null },
                orderBy: { validFrom: 'desc' },
                select: { id: true, validFrom: true },
            })

            if (current) {
                if (newFrom <= current.validFrom) {
                    throw new BadRequestException('Từ ngày phải lớn hơn từ ngày của địa chỉ hiện tại')
                }

                const prevTo = this.addDays(newFrom, -1)

                await tx.customerAddress.update({
                    where: { id: current.id },
                    data: { validTo: prevTo },
                })
            }

            return tx.customerAddress.create({
                data: {
                    customerId,
                    addressLine,
                    validFrom: newFrom,
                    validTo: null,
                    note,
                },
            })
        })
    }

    private async rebuildTimeline(tx: Prisma.TransactionClient, customerId: string) {
        const rows = await tx.customerAddress.findMany({
            where: { customerId },
            orderBy: { validFrom: 'asc' },
            select: { id: true, validFrom: true },
        })

        for (let i = 0; i < rows.length; i++) {
            const cur = rows[i]
            const next = rows[i + 1]
            const nextTo = next ? this.addDays(next.validFrom, -1) : null

            await tx.customerAddress.update({
                where: { id: cur.id },
                data: { validTo: nextTo },
            })
        }
    }

    async update(addressId: string, dto: UpdateCustomerAddressDto): Promise<CustomerAddress> {
        const existing = await this.prisma.customerAddress.findUnique({
            where: { id: addressId },
            select: { id: true, customerId: true, validFrom: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy địa chỉ')

        const nextValidFrom = dto.validFrom ? this.toDateOnly(dto.validFrom) : existing.validFrom

        return this.prisma.$transaction(async (tx) => {
            if (dto.validFrom) {
                const dup = await tx.customerAddress.findFirst({
                    where: {
                        customerId: existing.customerId,
                        id: { not: addressId },
                        validFrom: nextValidFrom,
                    },
                    select: { id: true },
                })
                if (dup) throw new BadRequestException('Đã có địa chỉ bắt đầu từ ngày này')
            }

            const updated = await tx.customerAddress.update({
                where: { id: addressId },
                data: {
                    addressLine: dto.addressLine ? dto.addressLine.trim() : undefined,
                    validFrom: dto.validFrom ? nextValidFrom : undefined,
                    note: dto.note !== undefined ? dto.note?.trim() : undefined,
                },
            })

            await this.rebuildTimeline(tx, existing.customerId)

            return updated
        })
    }

    async remove(addressId: string): Promise<CustomerAddress> {
        const existing = await this.prisma.customerAddress.findUnique({
            where: { id: addressId },
            select: { id: true, customerId: true },
        })
        if (!existing) throw new NotFoundException('Không tìm thấy địa chỉ')

        return this.prisma.$transaction(async (tx) => {
            const deleted = await tx.customerAddress.delete({ where: { id: addressId } })
            await this.rebuildTimeline(tx, existing.customerId)
            return deleted
        })
    }

    async getAddressAt(customerId: string, atDate: Date): Promise<CustomerAddress | null> {
        const d = this.toDateOnly(atDate)

        return this.prisma.customerAddress.findFirst({
            where: {
                customerId,
                validFrom: { lte: d },
                OR: [{ validTo: null }, { validTo: { gte: d } }],
            },
            orderBy: { validFrom: 'desc' },
        })
    }

    private toDateOnly(input: string | Date): Date {
        if (input instanceof Date) {
            const y = input.getUTCFullYear()
            const m = input.getUTCMonth()
            const d = input.getUTCDate()
            return new Date(Date.UTC(y, m, d))
        }

        // input dạng "YYYY-MM-DD"
        const [y, m, d] = input.split('-').map((x) => parseInt(x, 10))
        if (!y || !m || !d) throw new BadRequestException('Ngày không hợp lệ')

        return new Date(Date.UTC(y, m - 1, d))
    }

    private addDays(date: Date, days: number) {
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days))
    }
}
