import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common'
import { CreateUserDto, SetUserEmployeeDto, SetUserRolesDto, UpdateUserDto } from './dto/user.dto'
import { UsersService } from './users.service'

@Controller('users')
export class UsersController {
    constructor(private readonly service: UsersService) {}

    @Get()
    list(@Query() query: any) {
        return this.service.list(query)
    }

    @Get('roles')
    roles() {
        return this.service.listRoles()
    }

    @Get(':id')
    detail(@Param('id') id: string) {
        return this.service.detail(id)
    }

    @Post()
    create(@Body() dto: CreateUserDto) {
        return this.service.create(dto)
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
        return this.service.update(id, dto)
    }

    @Put(':id/roles')
    setRoles(@Param('id') id: string, @Body() dto: SetUserRolesDto) {
        return this.service.setGlobalRoles(id, dto.roleIds ?? [])
    }

    @Put(':id/employee')
    setEmployee(@Param('id') id: string, @Body() dto: SetUserEmployeeDto) {
        return this.service.setEmployee(id, dto.employeeId ?? null)
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.service.remove(id)
    }
}
