import { PartialType } from '@nestjs/mapped-types'
import { CreateDepartmentDto, DepartmentTypeDto } from './create-department.dto'
import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator'

export class UpdateDepartmentDto extends PartialType(CreateDepartmentDto) {
    @IsOptional()
    @IsString()
    @Length(2, 32)
    @Matches(/^[A-Za-z0-9._-]+$/)
    code?: string

    @IsOptional()
    @IsEnum(DepartmentTypeDto)
    type?: DepartmentTypeDto

    @IsOptional()
    parentId?: string

    @IsOptional()
    siteId?: string
}
