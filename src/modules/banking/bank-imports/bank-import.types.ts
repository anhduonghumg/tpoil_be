import { BankTxnDirection } from '@prisma/client'

export type NormalizedBankTxn = {
    txnDate: Date
    direction: BankTxnDirection
    amount: number
    description: string
    counterpartyName: string | null
    counterpartyAcc: string | null
    externalRef: string | null
    raw: any
}
