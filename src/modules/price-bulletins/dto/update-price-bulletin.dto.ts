// update-price-bulletin.dto.ts
import { PartialType } from '@nestjs/mapped-types'
import { CreatePriceBulletinDto } from './create-price-bulletin.dto'

export class UpdatePriceBulletinDto extends PartialType(CreatePriceBulletinDto) {}
