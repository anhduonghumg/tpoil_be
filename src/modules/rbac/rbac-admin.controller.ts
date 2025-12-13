import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { RbacAdminService } from './rbac-admin.service'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto'
import { CreateRoleDto } from './dto/create-role.dto'
import { UpdateRoleDto } from './dto/update-role.dto'
import { ListRolesQueryDto } from './dto/list-roles.query.dto'

@Controller('rbac/admin')
@UseGuards(LoggedInGuard, PermissionsGuard)
export class RbacAdminController {
    constructor(private readonly rbacAdmin: RbacAdminService) {}

    @Post('roles')
    createRole(@Body() dto: CreateRoleDto) {
        return this.rbacAdmin.createRole(dto)
    }

    @Patch('roles/:id')
    updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
        return this.rbacAdmin.updateRole(id, dto)
    }

    @Delete('roles/:id')
    deleteRole(@Param('id') id: string) {
        return this.rbacAdmin.deleteRole(id)
    }

    /**
     * Danh sách vai trò (Role list)
     */

    // @Get('roles')
    // @RequirePermissions(PERMISSIONS.system?.rbacAdmin ?? 'system.rbac')
    // async getRoles() {
    //     const items = await this.rbacAdmin.getRoles()
    //     return { items }
    // }

    @Get('roles')
    getRoles(@Query() q: ListRolesQueryDto) {
        return this.rbacAdmin.getRoles(q)
    }

    /**
     * Chi tiết 1 role + status permissions (assigned / not)
     */
    @Get('roles/:id')
    @RequirePermissions(PERMISSIONS.system?.rbacAdmin ?? 'system.rbac')
    async getRoleDetail(@Param('id') id: string) {
        const role = await this.rbacAdmin.getRoleDetail(id)
        return { role }
    }

    /**
     * Trả về toàn bộ permissions (có thể filter theo moduleCode)
     */
    @Get('permissions')
    @RequirePermissions(PERMISSIONS.system?.rbacAdmin ?? 'system.rbac')
    async getPermissions(@Query('moduleCode') moduleCode?: string) {
        const items = await this.rbacAdmin.getAllPermissions(moduleCode)
        return { items }
    }

    /**
     * Cập nhật danh sách permission của 1 role
     */
    @Put('roles/:id/permissions')
    @RequirePermissions(PERMISSIONS.system?.rbacAdmin ?? 'system.rbac')
    async updateRolePermissions(@Param('id') id: string, @Body() dto: UpdateRolePermissionsDto) {
        // console.log('body dto =', dto)
        // console.log('permissionIds =', dto.permissionIds?.length)
        await this.rbacAdmin.updateRolePermissions(id, dto.permissionIds ?? [])
        return { ok: true }
    }
}
