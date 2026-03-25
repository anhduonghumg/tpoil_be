import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { QueryBankTransactionsDto } from './dto/query-bank-transactions.dto'
import { ConfirmBankTransactionDto } from './dto/confirm-bank-transaction.dto'
import { BankingService } from './banking.service'

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
}
