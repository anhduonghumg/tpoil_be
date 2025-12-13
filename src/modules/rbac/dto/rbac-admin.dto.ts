// src/modules/rbac/dto/rbac-admin.dto.ts

export interface RoleSummaryDto {
    id: string
    code: string
    name: string
    desc: string | null
    userCount: number
}

export interface RoleDetailPermissionDto {
    id: string
    code: string
    name: string
    moduleCode: string
    moduleName: string
    assigned: boolean
}

export interface RoleDetailDto {
    id: string
    code: string
    name: string
    desc: string | null
    permissions: RoleDetailPermissionDto[]
}

export interface PermissionItemDto {
    id: string
    code: string
    name: string
    moduleCode: string
    moduleName: string
}

export class UpdateRolePermissionsDto {
    permissionIds: string[]
}
