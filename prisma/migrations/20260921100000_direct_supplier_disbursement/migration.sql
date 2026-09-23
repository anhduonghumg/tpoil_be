CREATE TYPE "PaymentFundingSource" AS ENUM ('OWN_BANK', 'DIRECT_DISBURSEMENT');

ALTER TABLE "PaymentRequestPayment"
  ADD COLUMN "fundingSource" "PaymentFundingSource" NOT NULL DEFAULT 'OWN_BANK',
  ADD COLUMN "lenderBankName" TEXT,
  ADD COLUMN "creditFacilityRef" TEXT,
  ADD COLUMN "disbursementNo" TEXT;

ALTER TABLE "PaymentRequestPayment"
  ALTER COLUMN "sourceBankAccountId" DROP NOT NULL;
