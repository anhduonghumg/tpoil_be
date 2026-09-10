-- Canonical receipt reconciliation: one normalized bank transaction stream for
-- manual entry, Excel imports and future provider webhooks.

ALTER TYPE "BankTxnMatchStatus" ADD VALUE IF NOT EXISTS 'IGNORED';

DO $$ BEGIN
  CREATE TYPE "BankTransactionSource" AS ENUM ('MANUAL', 'EXCEL', 'SEPAY', 'JETPAY');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "BankTxnReconciliationStatus" AS ENUM ('PENDING', 'SUGGESTED', 'PARTIALLY_ALLOCATED', 'ALLOCATED', 'IGNORED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "BankAccount" ADD COLUMN IF NOT EXISTS "legalEntityId" UUID;
ALTER TABLE "BankAccount" DROP CONSTRAINT IF EXISTS "BankAccount_bankCode_accountNo_key";
CREATE UNIQUE INDEX IF NOT EXISTS "BankAccount_legalEntityId_bankCode_accountNo_key"
  ON "BankAccount"("legalEntityId", "bankCode", "accountNo");
CREATE INDEX IF NOT EXISTS "BankAccount_legalEntityId_isActive_idx"
  ON "BankAccount"("legalEntityId", "isActive");
ALTER TABLE "BankAccount" DROP CONSTRAINT IF EXISTS "BankAccount_legalEntityId_fkey";
ALTER TABLE "BankAccount"
  ADD CONSTRAINT "BankAccount_legalEntityId_fkey"
  FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "BankTransaction"
  ADD COLUMN IF NOT EXISTS "valueDate" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "source" "BankTransactionSource" NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS "providerCode" TEXT,
  ADD COLUMN IF NOT EXISTS "providerTransactionId" TEXT,
  ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "reconciliationStatus" "BankTxnReconciliationStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "ignoredReason" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "BankTransaction_bankAccountId_source_providerTransactionId_key"
  ON "BankTransaction"("bankAccountId", "source", "providerTransactionId");
CREATE INDEX IF NOT EXISTS "BankTransaction_bankAccountId_reconciliationStatus_txnDate_idx"
  ON "BankTransaction"("bankAccountId", "reconciliationStatus", "txnDate");

ALTER TABLE "ReceivableAllocation" ADD COLUMN IF NOT EXISTS "effectiveAt" TIMESTAMPTZ(6);
UPDATE "ReceivableAllocation" SET "effectiveAt" = "allocatedAt" WHERE "effectiveAt" IS NULL;
