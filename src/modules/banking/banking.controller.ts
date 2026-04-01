import { Body, Controller, Delete, Get, Param, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { memoryStorage } from 'multer'
import { BankingService } from './banking.service'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { CreateBankImportDto } from './dto/create-bank-import.dto'
import { DeleteMultipleBankTransactionsDto } from './dto/delete-multiple-bank-transactions.dto'

@Controller('banking')
export class BankingController {
    constructor(private readonly bankingService: BankingService) {}

    @Get('transactions')
    listTransactions(@Query() query: QueryBankTransactionsDto) {
        return this.bankingService.listTransactions(query)
    }

    @Get('transactions/:id')
    getTransaction(@Param('id') id: string) {
        return this.bankingService.getTransactionDetail(id)
    }

    @Get('transactions/:id/suggestions')
    getSuggestions(@Param('id') id: string) {
        return this.bankingService.getMatchSuggestions(id)
    }

    @Post('transactions/:id/confirm')
    confirmTransaction(@Param('id') id: string, @Body() body: ConfirmBankTransactionDto) {
        return this.bankingService.confirmTransaction(id, body)
    }

    @Get('templates')
    listTemplates(@Query('bankCode') bankCode?: string) {
        return this.bankingService.listTemplates(bankCode)
    }

    @Get('imports/:id')
    getImportDetail(@Param('id') id: string) {
        return this.bankingService.getImportDetail(id)
    }

    @Post('imports/commit')
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

    @Delete('transactions/:id')
    remove(@Param('id') id: string) {
        return this.bankingService.remove(id)
    }

    @Post('transactions/delete-multiple')
    deleteMultiple(@Body() dto: DeleteMultipleBankTransactionsDto) {
        return this.bankingService.deleteMultiple(dto)
    }
}
