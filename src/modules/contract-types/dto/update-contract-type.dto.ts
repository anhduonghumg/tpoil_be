import { PartialType } from '@nestjs/mapped-types'
import { CreateContractTypeDto } from './create-contract-type.dto'

export class UpdateContractTypeDto extends PartialType(CreateContractTypeDto) {}
