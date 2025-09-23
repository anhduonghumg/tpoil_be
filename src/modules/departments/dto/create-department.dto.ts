import { IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator'

export enum DepartmentTypeDto {
    board = 'board',
    office = 'office',
    group = 'group',
    branch = 'branch',
}

export class CreateDepartmentDto {
    @IsString()
    @Length(2, 32)
    @Matches(/^[A-Za-z0-9._-]+$/, { message: 'code chỉ gồm chữ/số/._-' })
    code!: string

    @IsString()
    @Length(2, 128)
    name!: string

    @IsEnum(DepartmentTypeDto)
    type!: DepartmentTypeDto

    @IsOptional()
    parentId?: string

    @IsOptional()
    siteId?: string

    @IsOptional()
    @IsString()
    costCenter?: string
}
