CREATE TYPE "GeneralPaymentRequestCategory" AS ENUM (
  'INTERNAL_EXPENSE',
  'FIXED_ASSET',
  'TAX_AND_FEE',
  'ADVANCE',
  'OTHER'
);

CREATE TYPE "GeneralPaymentRequestStatus" AS ENUM (
  'PENDING_APPROVAL',
  'REJECTED',
  'APPROVED',
  'BANK_VERIFIED',
  'BANK_RETURNED',
  'PARTIALLY_PAID',
  'PAID',
  'CANCELLED'
);

CREATE TABLE "GeneralPaymentRequest" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "requestNo" TEXT NOT NULL,
  "requestDate" DATE NOT NULL,
  "category" "GeneralPaymentRequestCategory" NOT NULL,
  "beneficiaryName" TEXT NOT NULL,
  "beneficiaryTaxCode" TEXT,
  "beneficiaryAccountNo" TEXT,
  "beneficiaryAccountName" TEXT,
  "beneficiaryBankName" TEXT,
  "content" TEXT NOT NULL,
  "referenceNo" TEXT,
  "invoiceNo" TEXT,
  "amountVnd" DECIMAL(18,2) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'VND',
  "paymentDeadline" DATE,
  "status" "GeneralPaymentRequestStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
  "note" TEXT,
  "approvalNote" TEXT,
  "approvedById" UUID,
  "approvedAt" TIMESTAMP(3),
  "bankCheckedById" UUID,
  "bankCheckedAt" TIMESTAMP(3),
  "bankCheckNote" TEXT,
  "returnedReason" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GeneralPaymentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneralPaymentRequest_requestNo_key" ON "GeneralPaymentRequest"("requestNo");
CREATE INDEX "GeneralPaymentRequest_status_requestDate_idx" ON "GeneralPaymentRequest"("status", "requestDate");
CREATE INDEX "GeneralPaymentRequest_category_status_idx" ON "GeneralPaymentRequest"("category", "status");
CREATE INDEX "GeneralPaymentRequest_beneficiaryName_idx" ON "GeneralPaymentRequest"("beneficiaryName");

CREATE TABLE "GeneralPaymentRequestPayment" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "paymentRequestId" UUID NOT NULL,
  "fundingSource" "PaymentFundingSource" NOT NULL DEFAULT 'OWN_BANK',
  "sourceBankAccountId" UUID,
  "lenderBankName" TEXT,
  "creditFacilityRef" TEXT,
  "disbursementNo" TEXT,
  "amountVnd" DECIMAL(18,2) NOT NULL,
  "paidAt" DATE NOT NULL,
  "proofFileUrl" TEXT,
  "proofFileName" TEXT,
  "note" TEXT,
  "createdById" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GeneralPaymentRequestPayment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GeneralPaymentRequestPayment_paymentRequestId_paidAt_idx" ON "GeneralPaymentRequestPayment"("paymentRequestId", "paidAt");
CREATE INDEX "GeneralPaymentRequestPayment_sourceBankAccountId_idx" ON "GeneralPaymentRequestPayment"("sourceBankAccountId");

ALTER TABLE "GeneralPaymentRequestPayment"
  ADD CONSTRAINT "GeneralPaymentRequestPayment_paymentRequestId_fkey"
  FOREIGN KEY ("paymentRequestId") REFERENCES "GeneralPaymentRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "GeneralPaymentRequestPayment"
  ADD CONSTRAINT "GeneralPaymentRequestPayment_sourceBankAccountId_fkey"
  FOREIGN KEY ("sourceBankAccountId") REFERENCES "BankAccount"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
