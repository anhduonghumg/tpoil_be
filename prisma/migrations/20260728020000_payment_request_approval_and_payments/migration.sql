ALTER TYPE "public"."TermPaymentRequestStatus" ADD VALUE IF NOT EXISTS 'PENDING_DIRECTOR_APPROVAL';
ALTER TYPE "public"."TermPaymentRequestStatus" ADD VALUE IF NOT EXISTS 'DIRECTOR_REJECTED';
ALTER TYPE "public"."TermPaymentRequestStatus" ADD VALUE IF NOT EXISTS 'BANK_VERIFIED';
ALTER TYPE "public"."TermPaymentRequestStatus" ADD VALUE IF NOT EXISTS 'BANK_RETURNED';

CREATE TABLE "public"."PartyBankAccount" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(), "partyId" UUID NOT NULL,
  "bankName" TEXT NOT NULL, "bankCode" TEXT, "accountNo" TEXT NOT NULL, "accountName" TEXT NOT NULL,
  "isDefault" BOOLEAN NOT NULL DEFAULT false, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PartyBankAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartyBankAccount_partyId_accountNo_key" ON "public"."PartyBankAccount"("partyId", "accountNo");
CREATE INDEX "PartyBankAccount_partyId_isActive_idx" ON "public"."PartyBankAccount"("partyId", "isActive");
ALTER TABLE "public"."PartyBankAccount" ADD CONSTRAINT "PartyBankAccount_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "public"."Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."PurchaseTermPaymentRequest"
  ADD COLUMN "beneficiaryBankAccountId" UUID, ADD COLUMN "beneficiaryAccountNo" TEXT,
  ADD COLUMN "beneficiaryAccountName" TEXT, ADD COLUMN "beneficiaryBankName" TEXT,
  ADD COLUMN "approvalNote" TEXT, ADD COLUMN "approvedById" UUID, ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "bankCheckedById" UUID, ADD COLUMN "bankCheckedAt" TIMESTAMP(3),
  ADD COLUMN "bankCheckNote" TEXT, ADD COLUMN "returnedReason" TEXT;
CREATE INDEX "PurchaseTermPaymentRequest_beneficiaryBankAccountId_idx" ON "public"."PurchaseTermPaymentRequest"("beneficiaryBankAccountId");
ALTER TABLE "public"."PurchaseTermPaymentRequest" ADD CONSTRAINT "PurchaseTermPaymentRequest_beneficiaryBankAccountId_fkey" FOREIGN KEY ("beneficiaryBankAccountId") REFERENCES "public"."PartyBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."PaymentRequestPayment" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(), "paymentRequestId" UUID NOT NULL, "sourceBankAccountId" UUID NOT NULL,
  "amountVnd" DECIMAL(18,2) NOT NULL, "paidAt" DATE NOT NULL, "proofFileUrl" TEXT, "proofFileName" TEXT,
  "note" TEXT, "createdById" UUID, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentRequestPayment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PaymentRequestPayment_paymentRequestId_paidAt_idx" ON "public"."PaymentRequestPayment"("paymentRequestId", "paidAt");
CREATE INDEX "PaymentRequestPayment_sourceBankAccountId_idx" ON "public"."PaymentRequestPayment"("sourceBankAccountId");
ALTER TABLE "public"."PaymentRequestPayment" ADD CONSTRAINT "PaymentRequestPayment_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "public"."PurchaseTermPaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "public"."PaymentRequestPayment" ADD CONSTRAINT "PaymentRequestPayment_sourceBankAccountId_fkey" FOREIGN KEY ("sourceBankAccountId") REFERENCES "public"."BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
