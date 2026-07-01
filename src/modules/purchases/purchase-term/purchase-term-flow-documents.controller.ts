import { Body, Controller, Param, Post } from '@nestjs/common'
import {
    CreateTermBankInstructionDto,
    CreateTermPaymentRequestDto,
    CreateTermSettlementAdjustmentDto,
    MatchTermBankInstructionDto,
} from './dto/term-flow-documents.dto'
import { PurchaseTermFlowDocumentsService } from './purchase-term-flow-documents.service'

@Controller('purchase-terms')
export class PurchaseTermFlowDocumentsController {
    constructor(private readonly service: PurchaseTermFlowDocumentsService) {}

    @Post(':orderId/payment-request')
    createPaymentRequest(@Param('orderId') orderId: string, @Body() dto: CreateTermPaymentRequestDto) {
        return this.service.createPaymentRequest(orderId, dto)
    }

    @Post(':orderId/bank-instruction')
    createBankInstruction(@Param('orderId') orderId: string, @Body() dto: CreateTermBankInstructionDto) {
        return this.service.createBankInstruction(orderId, dto)
    }

    @Post(':orderId/bank-instruction/:instructionId/match')
    matchBankInstruction(@Param('orderId') orderId: string, @Param('instructionId') instructionId: string, @Body() dto: MatchTermBankInstructionDto) {
        return this.service.matchBankInstruction(orderId, instructionId, dto)
    }

    @Post(':orderId/settlement-adjustment')
    createSettlementAdjustment(@Param('orderId') orderId: string, @Body() dto: CreateTermSettlementAdjustmentDto) {
        return this.service.createSettlementAdjustment(orderId, dto)
    }
}
