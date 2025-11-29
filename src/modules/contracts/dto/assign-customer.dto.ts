// src/modules/contracts/dto/assign-customer.dto.ts
import { IsUUID } from 'class-validator'

export class AssignCustomerToContractDto {
    @IsUUID()
    customerId: string
}
