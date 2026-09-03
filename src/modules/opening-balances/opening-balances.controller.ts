import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { OpeningDebtSide } from '@prisma/client'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request, Response } from 'express'
import { memoryStorage } from 'multer'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { CreateOpeningBalanceBatchDto, ListOpeningBalanceBatchesDto, OpeningDebtLineDto, OpeningInventoryLineDto, ReplaceOpeningBalanceLinesDto, UpdateOpeningBalanceBatchDto } from './dto/opening-balance.dto'
import { OpeningBalancesService } from './opening-balances.service'

function actorId(req: Request) {
    return (req.session as any)?.auth?.userId ?? (req as any).user?.id ?? null
}

function debtSide(value: string) {
    const side = value?.toUpperCase()
    if (side !== OpeningDebtSide.RECEIVABLE && side !== OpeningDebtSide.PAYABLE) {
        throw new BadRequestException({ code: 'INVALID_OPENING_DEBT_SIDE', message: 'Loại công nợ đầu kỳ không hợp lệ.' })
    }
    return side
}

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('opening-balances')
export class OpeningBalancesController {
    constructor(private readonly service: OpeningBalancesService) {}

    @Get()
    @RequirePermissions(PERMISSIONS.system.openingBalancesView)
    list(@Query() query: ListOpeningBalanceBatchesDto) { return this.service.list(query) }

    @Get('options')
    @RequirePermissions(PERMISSIONS.system.openingBalancesView)
    options() { return this.service.options() }

    @Get('template')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    async template(@Res() response: Response) {
        const buffer = await this.service.template()
        response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response.setHeader('Content-Disposition', 'attachment; filename="mau-so-du-dau-ky.xlsx"')
        response.send(Buffer.from(buffer))
    }

    @Get('template/:section')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    async sectionTemplate(@Param('section') section: string, @Res() response: Response) {
        const buffer = await this.service.template(section)
        const names: Record<string, string> = {
            INVENTORY: 'mau-ton-kho-dau-ky.xlsx',
            RECEIVABLE: 'mau-phai-thu-dau-ky.xlsx',
            PAYABLE: 'mau-phai-tra-dau-ky.xlsx',
        }
        response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
        response.setHeader('Content-Disposition', `attachment; filename="${names[section.toUpperCase()] ?? 'mau-so-du-dau-ky.xlsx'}"`)
        response.send(Buffer.from(buffer))
    }

    @Get(':id')
    @RequirePermissions(PERMISSIONS.system.openingBalancesView)
    detail(@Param('id') id: string) { return this.service.detail(id) }

    @Post()
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    create(@Body() dto: CreateOpeningBalanceBatchDto, @Req() req: Request) { return this.service.create(dto, actorId(req)) }

    @Patch(':id')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    update(@Param('id') id: string, @Body() dto: UpdateOpeningBalanceBatchDto) { return this.service.update(id, dto) }

    @Put(':id/lines')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    replaceLines(@Param('id') id: string, @Body() dto: ReplaceOpeningBalanceLinesDto) { return this.service.replaceLines(id, dto) }

    @Post(':id/import')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
    import(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) { return this.service.import(id, file) }

    @Post(':id/import/:section')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
    importSection(@Param('id') id: string, @Param('section') section: string, @UploadedFile() file: Express.Multer.File) {
        return this.service.import(id, file, section)
    }

    @Post(':id/inventory-lines')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    createInventoryLine(@Param('id') id: string, @Body() dto: OpeningInventoryLineDto) {
        return this.service.createInventoryLine(id, dto)
    }

    @Patch(':id/inventory-lines/:lineId')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    updateInventoryLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: OpeningInventoryLineDto) {
        return this.service.updateInventoryLine(id, lineId, dto)
    }

    @Delete(':id/inventory-lines/:lineId')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    deleteInventoryLine(@Param('id') id: string, @Param('lineId') lineId: string) {
        return this.service.deleteInventoryLine(id, lineId)
    }

    @Post(':id/debt-lines/:side')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    createDebtLine(@Param('id') id: string, @Param('side') side: string, @Body() dto: OpeningDebtLineDto) {
        return this.service.createDebtLine(id, debtSide(side), dto)
    }

    @Patch(':id/debt-lines/:lineId')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    updateDebtLine(@Param('id') id: string, @Param('lineId') lineId: string, @Body() dto: OpeningDebtLineDto) {
        return this.service.updateDebtLine(id, lineId, dto)
    }

    @Delete(':id/debt-lines/:lineId')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    deleteDebtLine(@Param('id') id: string, @Param('lineId') lineId: string) {
        return this.service.deleteDebtLine(id, lineId)
    }

    @Post(':id/validate')
    @RequirePermissions(PERMISSIONS.system.openingBalancesManage)
    validate(@Param('id') id: string, @Req() req: Request) { return this.service.validate(id, actorId(req)) }

    @Post(':id/post')
    @RequirePermissions(PERMISSIONS.system.openingBalancesPost)
    post(@Param('id') id: string, @Req() req: Request) { return this.service.post(id, actorId(req)) }

    @Post(':id/reverse')
    @RequirePermissions(PERMISSIONS.system.openingBalancesPost)
    reverse(@Param('id') id: string, @Req() req: Request) { return this.service.reverse(id, actorId(req)) }
}
