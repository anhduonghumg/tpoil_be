import { Injectable, NotFoundException } from '@nestjs/common'
import { ContractStatus } from '@prisma/client'
import { CustomerOverviewResponseDto, CustomerOverviewContractMiniDto, CustomerOwnerMiniDto } from './dto/customer-overview.dto'
import { PrismaService } from 'src/infra/prisma/prisma.service'

@Injectable()
export class CustomerOverviewService {
    constructor(private readonly prisma: PrismaService) {}

    async getOverview(customerId: string): Promise<CustomerOverviewResponseDto> {
        const customer = await this.prisma.party.findFirst({
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

        // Real receivable position instead of the previous placeholder zeros.
        const receivables = await this.prisma.receivableOpenItem.findMany({
            where: {
                customerPartyId: customer.id,
                status: { not: 'VOIDED' },
                settlementType: 'RECEIVABLE',
            },
            select: {
                originalAmount: true,
                outstandingAmount: true,
                dueDate: true,
                status: true,
            },
        })
        // dueDate is a DATE: something due today is not overdue yet.
        const asOf = new Date()
        asOf.setHours(0, 0, 0, 0)
        const sum = (values: Array<{ toNumber?: () => number } | any>) =>
            values.reduce((total, value) => total + (value?.toNumber?.() ?? Number(value ?? 0)), 0)
        const invoices = sum(receivables.map((item) => item.originalAmount))
        const balance = sum(
            receivables.filter((item) => item.status !== 'SETTLED').map((item) => item.outstandingAmount),
        )
        const debt = {
            opening: 0,
            invoices,
            payments: invoices - balance,
            balance,
            overdue: sum(
                receivables
                    .filter((item) => item.status !== 'SETTLED' && item.dueDate && item.dueDate < asOf)
                    .map((item) => item.outstandingAmount),
            ),
            openItems: receivables.filter((item) => item.status !== 'SETTLED').length,
            currency: 'VND',
        }

        // Commercial stock the customer still holds on active lot orders (spec v1.2 §11).
        const lotPositions = await this.prisma.salesLotPosition.findMany({
            where: {
                orderLine: {
                    salesOrder: { kind: 'LOT', status: 'CONFIRMED', customerPartyId: customer.id },
                },
            },
            include: {
                orderLine: {
                    include: {
                        product: { select: { id: true, code: true, name: true, uom: true } },
                        issueWarehouse: { select: { id: true, code: true, name: true } },
                    },
                },
            },
        })
        const inventory = {
            items: lotPositions.map((position) => ({
                sku: position.orderLine.product.code,
                name: position.orderLine.product.name,
                warehouseCode: position.orderLine.issueWarehouse?.code ?? '',
                warehouseName: position.orderLine.issueWarehouse?.name,
                qty: position.totalQty
                    .minus(position.issuedQty)
                    .minus(position.adjustedQty)
                    .toNumber(),
            })),
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
