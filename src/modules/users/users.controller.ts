import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common'
import { CreateUserDto, ResetPasswordDto, SetUserEmployeeDto, SetUserRolesDto, UpdateUserDto } from './dto/user.dto'
import { UsersService } from './users.service'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { LoggedInGuard } from '../auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
    constructor(private readonly service: UsersService) {}

    @RequirePermissions(PERMISSIONS.users.view ?? 'users.view')
    @Get()
    list(@Query() query: any) {
        return this.service.list(query)
    }

    @RequirePermissions(PERMISSIONS.users.view ?? 'users.view')
    @Get('roles')
    roles() {
        return this.service.listRoles()
    }

    @RequirePermissions(PERMISSIONS.users.view ?? 'users.view')
    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @RequirePermissions(PERMISSIONS.users.create ?? 'users.create')
    @Post()
    create(@Body() dto: CreateUserDto) {
        return this.service.create(dto)
    }

    @RequirePermissions(PERMISSIONS.users.update ?? 'users.update')
    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
        return this.service.update(id, dto)
    }

    @RequirePermissions(PERMISSIONS.users.assignRoles ?? 'users.assign_roles')
    @Put(':id/roles')
    setRoles(@Param('id') id: string, @Body() dto: SetUserRolesDto) {
        return this.service.setGlobalRoles(id, dto.roleIds ?? [])
    }

    @RequirePermissions(PERMISSIONS.users.assignEmployee ?? 'users.assign_employee')
    @Put(':id/employee')
    setEmployee(@Param('id') id: string, @Body() dto: SetUserEmployeeDto) {
        return this.service.setEmployee(id, dto.employeeId ?? null)
    }

    @RequirePermissions(PERMISSIONS.users.delete ?? 'users.delete')
    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.service.remove(id)
    }

    @RequirePermissions(PERMISSIONS.users.resetPassword ?? 'users.reset_password')
    @Put(':id/password')
    resetPassword(@Param('id') id: string, @Body() dto: ResetPasswordDto) {
        return this.service.resetPassword(id, dto)
    }
}
