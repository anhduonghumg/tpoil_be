import { Injectable, NotFoundException } from '@nestjs/common'
import { ContractStatus } from '@prisma/client'
import { CustomerOverviewResponseDto, CustomerOverviewContractMiniDto, CustomerOwnerMiniDto } from './dto/customer-overview.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class CustomerOverviewService {
    constructor(private readonly prisma: PrismaService) {}

    async getOverview(customerId: string): Promise<CustomerOverviewResponseDto> {
        const customer = await this.prisma.customer.findFirst({
            where: { id: customerId, deletedAt: null },
            include: {
                salesOwnerEmp: {
                    select: { id: true, fullName: true, title: true, phone: true, workEmail: true },
                },
                accountingOwnerEmp: {
                    select: { id: true, fullName: true, title: true, phone: true, workEmail: true },
                },
                legalOwnerEmp: {
                    select: { id: true, fullName: true, title: true, phone: true, workEmail: true },
                },
            },
        })

        if (!customer) {
            throw new NotFoundException('Customer not found')
        }

        const now = new Date()

        const contracts = await this.prisma.contract.findMany({
            where: { customerId, deletedAt: null },
            include: {
                contractType: { select: { code: true, name: true } },
            },
            orderBy: { startDate: 'desc' },
        })

        const grouped = {
            active: [] as CustomerOverviewContractMiniDto[],
            upcoming: [] as CustomerOverviewContractMiniDto[],
            expired: [] as CustomerOverviewContractMiniDto[],
            terminated: [] as CustomerOverviewContractMiniDto[],
            cancelled: [] as CustomerOverviewContractMiniDto[],
        }

        for (const c of contracts) {
            const base: CustomerOverviewContractMiniDto = {
                id: c.id,
                code: c.code,
                name: c.name,
                contractTypeCode: c.contractType?.code ?? null,
                contractTypeName: c.contractType?.name ?? null,
                startDate: c.startDate,
                endDate: c.endDate,
                status: c.status,
                paymentTermDays: c.paymentTermDays ?? null,
                riskLevel: c.riskLevel,
            }

            if (c.status === ContractStatus.Cancelled) {
                grouped.cancelled.push(base)
                continue
            }
            if (c.status === ContractStatus.Terminated) {
                grouped.terminated.push(base)
                continue
            }

            if (c.startDate > now) {
                grouped.upcoming.push(base)
            } else if (c.endDate < now) {
                grouped.expired.push(base)
            } else {
                grouped.active.push(base)
            }
        }

        const mapOwner = (emp?: any | null): CustomerOwnerMiniDto | null => {
            if (!emp) return null
            return {
                id: emp.id,
                fullName: emp.fullName,
                title: emp.title,
                phone: emp.phone,
                workEmail: emp.workEmail,
            }
        }

        const debt = {
            opening: 0,
            invoices: 0,
            payments: 0,
            balance: 0,
            currency: 'VND',
        }

        const inventory = {
            items: [],
            totalValue: 0,
            currency: 'VND',
        }

        const creditLimit = (customer.creditLimit as any)?.toNumber?.() ?? (customer.creditLimit as any)
        const tempLimit = (customer.tempLimit as any)?.toNumber?.() ?? (customer.tempLimit as any)

        return {
            customer: {
                id: customer.id,
                code: customer.code,
                name: customer.name,
                type: customer.type,
                status: customer.status,
                taxCode: customer.taxCode,
                billingAddress: customer.billingAddress,
                shippingAddress: customer.shippingAddress,
                contactEmail: customer.contactEmail,
                contactPhone: customer.contactPhone,
                owners: {
                    sales: mapOwner(customer.salesOwnerEmp),
                    accounting: mapOwner(customer.accountingOwnerEmp),
                    legal: mapOwner(customer.legalOwnerEmp),
                },
                credit: {
                    creditLimit,
                    tempLimit,
                    tempFrom: customer.tempFrom,
                    tempTo: customer.tempTo,
                },
            },
            contracts: grouped,
            debt,
            inventory,
        }
    }
}
