import { Body, Controller, Delete, Get, Param, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors, ParseUUIDPipe } from '@nestjs/common'
import type { Request } from 'express'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { BankingService } from './banking.service'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { CreateBankImportDto } from './dto/create-bank-import.dto'
import { DeleteMultipleBankTransactionsDto } from './dto/delete-multiple-bank-transactions.dto'
import { CreateManualBankTransactionDto } from './dto/create-manual-bank-transaction.dto'
import { IgnoreBankTransactionDto } from './dto/ignore-bank-transaction.dto'
import {
    IgnoreBankTransactionsDto,
    RecognizeBankTransactionsDto,
    ReconcileCommercialPaymentDto,
    RecordCommercialFromStatementDto,
    ReverseCommercialReconciliationDto,
} from './dto/bank-transaction-batch.dto'
import { CommercialPaymentReconciliationService } from './commercial-payment-reconciliation.service'
import { LoggedInGuard } from 'src/modules/auth/guards/logged-in.guard'
import { PermissionsGuard } from 'src/common/auth/permissions.guard'
import { RequirePermissions } from 'src/common/auth/permissions.decorator'
import { PERMISSIONS } from 'src/common/auth/permissions.constant'

@UseGuards(LoggedInGuard, PermissionsGuard)
@Controller('banking')
export class BankingController {
    constructor(
        private readonly bankingService: BankingService,
        private readonly commercialReconciliation: CommercialPaymentReconciliationService,
    ) {}

    @Get('transactions')
    @RequirePermissions(PERMISSIONS.banking.view)
    listTransactions(@Query() query: QueryBankTransactionsDto) {
        return this.bankingService.listTransactions(query)
    }

    @Get('transactions/:id')
    @RequirePermissions(PERMISSIONS.banking.view)
    getTransaction(@Param('id', ParseUUIDPipe) id: string) {
        return this.bankingService.getTransactionDetail(id)
    }

    /** Đề xuất đối tượng (khách / nội bộ / phí NH) cho các dòng sao kê; không ghi gì. */
    @Post('transactions/recognize')
    @RequirePermissions(PERMISSIONS.banking.view)
    recognizeTransactions(@Body() body: RecognizeBankTransactionsDto) {
        return this.bankingService.recognizeTransactions(body.ids)
    }

    @Post('transactions/ignore-batch')
    @RequirePermissions(PERMISSIONS.banking.update)
    ignoreTransactions(@Body() body: IgnoreBankTransactionsDto) {
        return this.bankingService.ignoreTransactions(body.ids, body.counterpartyType, body.reason)
    }

    /** Ghép dòng tiền ra với lần chi Mua TM đã ghi nhận. */
    @Post('transactions/:id/commercial-reconcile')
    @RequirePermissions(PERMISSIONS.banking.update)
    reconcileCommercial(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReconcileCommercialPaymentDto, @Req() req: Request) {
        return this.commercialReconciliation.reconcile(id, body, (req as any).user?.id)
    }

    /** Ghi nhận đã chi Mua TM từ chính dòng sao kê rồi ghép luôn. */
    @Post('transactions/:id/commercial-record')
    @RequirePermissions(PERMISSIONS.banking.update)
    recordCommercialFromStatement(@Param('id', ParseUUIDPipe) id: string, @Body() body: RecordCommercialFromStatementDto, @Req() req: Request) {
        return this.commercialReconciliation.recordFromStatement(id, body, (req as any).user?.id)
    }

    @Post('commercial-reconciliations/:id/reverse')
    @RequirePermissions(PERMISSIONS.banking.update)
    reverseCommercialReconciliation(@Param('id', ParseUUIDPipe) id: string, @Body() body: ReverseCommercialReconciliationDto, @Req() req: Request) {
        return this.commercialReconciliation.reverse(id, body.reason, (req as any).user?.id)
    }

    @Post('transactions/manual')
    @RequirePermissions(PERMISSIONS.banking.create)
    createManualTransaction(@Body() body: CreateManualBankTransactionDto) {
        return this.bankingService.createManualTransaction(body)
    }

    @Get('transactions/:id/suggestions')
    @RequirePermissions(PERMISSIONS.banking.view)
    getSuggestions(@Param('id', ParseUUIDPipe) id: string) {
        return this.bankingService.getMatchSuggestions(id)
    }

    @Post('transactions/:id/confirm')
    @RequirePermissions(PERMISSIONS.banking.update)
    confirmTransaction(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmBankTransactionDto) {
        return this.bankingService.confirmTransaction(id, body)
    }

    @Post('transactions/:id/ignore')
    @RequirePermissions(PERMISSIONS.banking.update)
    ignoreTransaction(@Param('id', ParseUUIDPipe) id: string, @Body() body: IgnoreBankTransactionDto) {
        return this.bankingService.ignoreTransaction(id, body.reason)
    }

    @Post('transactions/:id/restore')
    @RequirePermissions(PERMISSIONS.banking.update)
    restoreTransaction(@Param('id', ParseUUIDPipe) id: string) {
        return this.bankingService.restoreTransaction(id)
    }

    @Get('templates')
    @RequirePermissions(PERMISSIONS.banking.view)
    listTemplates(@Query('bankCode') bankCode?: string) {
        return this.bankingService.listTemplates(bankCode)
    }

    @Get('imports/:id')
    @RequirePermissions(PERMISSIONS.banking.view)
    getImportDetail(@Param('id', ParseUUIDPipe) id: string) {
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
    remove(@Param('id', ParseUUIDPipe) id: string) {
        return this.bankingService.remove(id)
    }

    @Post('transactions/delete-multiple')
    @RequirePermissions(PERMISSIONS.banking.delete)
    deleteMultiple(@Body() dto: DeleteMultipleBankTransactionsDto) {
        return this.bankingService.deleteMultiple(dto)
    }
}
