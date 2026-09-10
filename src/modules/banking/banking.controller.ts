import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { BankingService } from './banking.service'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { CreateBankImportDto } from './dto/create-bank-import.dto'
import { DeleteMultipleBankTransactionsDto } from './dto/delete-multiple-bank-transactions.dto'
import { CreateManualBankTransactionDto } from './dto/create-manual-bank-transaction.dto'
import { IgnoreBankTransactionDto } from './dto/ignore-bank-transaction.dto'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('banking')
export class BankingController {
    constructor(private readonly bankingService: BankingService) {}

    @Get('transactions')
    @RequirePermissions(PERMISSIONS.banking.view)
    listTransactions(@Query() query: QueryBankTransactionsDto) {
        return this.bankingService.listTransactions(query)
    }

    @Get('transactions/:id')
    @RequirePermissions(PERMISSIONS.banking.view)
    getTransaction(@Param('id') id: string) {
        return this.bankingService.getTransactionDetail(id)
    }

    @Post('transactions/manual')
    @RequirePermissions(PERMISSIONS.banking.create)
    createManualTransaction(@Body() body: CreateManualBankTransactionDto) {
        return this.bankingService.createManualTransaction(body)
    }

    @Get('transactions/:id/suggestions')
    @RequirePermissions(PERMISSIONS.banking.view)
    getSuggestions(@Param('id') id: string) {
        return this.bankingService.getMatchSuggestions(id)
    }

    @Post('transactions/:id/confirm')
    @RequirePermissions(PERMISSIONS.banking.update)
    confirmTransaction(@Param('id') id: string, @Body() body: ConfirmBankTransactionDto) {
        return this.bankingService.confirmTransaction(id, body)
    }

    @Post('transactions/:id/ignore')
    @RequirePermissions(PERMISSIONS.banking.update)
    ignoreTransaction(@Param('id') id: string, @Body() body: IgnoreBankTransactionDto) {
        return this.bankingService.ignoreTransaction(id, body.reason)
    }

    @Get('templates')
    @RequirePermissions(PERMISSIONS.banking.view)
    listTemplates(@Query('bankCode') bankCode?: string) {
        return this.bankingService.listTemplates(bankCode)
    }

    @Get('imports/:id')
    @RequirePermissions(PERMISSIONS.banking.view)
    getImportDetail(@Param('id') id: string) {
        return this.bankingService.getImportDetail(id)
    }

    @Post('imports/commit')
    @RequirePermissions(PERMISSIONS.banking.create)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: {
                fileSize: 10 * 1024 * 1024,
            },
        }),
    )
    createImport(@UploadedFile() file: Express.Multer.File, @Body() body: CreateBankImportDto) {
        return this.bankingService.importStatement(file, body)
    }

    @Post('imports/preview')
    @RequirePermissions(PERMISSIONS.banking.create)
    @UseInterceptors(
        FileInterceptor('file', {
            storage: memoryStorage(),
            limits: {
                fileSize: 10 * 1024 * 1024,
            },
        }),
    )
    previewImport(@UploadedFile() file: Express.Multer.File, @Body() body: CreateBankImportDto) {
        return this.bankingService.previewImportStatement(file, body)
    }

    @Delete('transactions/:id')
    @RequirePermissions(PERMISSIONS.banking.delete)
    remove(@Param('id') id: string) {
        return this.bankingService.remove(id)
    }

    @Post('transactions/delete-multiple')
    @RequirePermissions(PERMISSIONS.banking.delete)
    deleteMultiple(@Body() dto: DeleteMultipleBankTransactionsDto) {
        return this.bankingService.deleteMultiple(dto)
    }
}
