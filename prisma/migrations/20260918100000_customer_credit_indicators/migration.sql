CREATE TYPE "CollectionPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CARRIED_FORWARD', 'CANCELLED');
CREATE TYPE "CustomerReceiptStatus" AS ENUM ('REPORTED', 'CONFIRMED', 'RECONCILED', 'REVERSED');
CREATE TYPE "CreditLimitProposalStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

ALTER TABLE "ReceivableAllocation" ALTER COLUMN "bankTransactionId" DROP NOT NULL;
ALTER TABLE "ReceivableAllocation" ADD COLUMN "customerReceiptId" UUID;

CREATE TABLE "CustomerCollectionPlan" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerPartyId" UUID NOT NULL,
    "plannedDate" DATE NOT NULL,
    "plannedAmount" DECIMAL(24,4) NOT NULL,
    "status" "CollectionPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "confirmationNote" TEXT,
    "note" TEXT,
    "parentPlanId" UUID,
    "createdById" UUID,
    "completedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CustomerCollectionPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerReceipt" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerPartyId" UUID NOT NULL,
    "collectionPlanId" UUID,
    "bankTransactionId" UUID,
    "amount" DECIMAL(24,4) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "receivedAt" TIMESTAMPTZ(6) NOT NULL,
    "status" "CustomerReceiptStatus" NOT NULL DEFAULT 'REPORTED',
    "transferReference" TEXT,
    "evidenceReference" TEXT,
    "note" TEXT,
    "reportedById" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(6),
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CustomerReceipt_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CreditLimitProposal" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "customerId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "proposedLimit" DECIMAL(24,4),
    "approvedLimit" DECIMAL(24,4),
    "status" "CreditLimitProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "reason" TEXT,
    "proposedById" UUID,
    "approvedById" UUID,
    "approvedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CreditLimitProposal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerReceipt_bankTransactionId_key" ON "CustomerReceipt"("bankTransactionId");
CREATE UNIQUE INDEX "CreditLimitProposal_customerId_year_key" ON "CreditLimitProposal"("customerId", "year");
CREATE INDEX "CreditLimitProposal_year_status_idx" ON "CreditLimitProposal"("year", "status");
CREATE INDEX "ReceivableAllocation_customerReceiptId_status_idx" ON "ReceivableAllocation"("customerReceiptId", "status");
CREATE INDEX "CustomerCollectionPlan_customerPartyId_plannedDate_idx" ON "CustomerCollectionPlan"("customerPartyId", "plannedDate");
CREATE INDEX "CustomerCollectionPlan_plannedDate_status_idx" ON "CustomerCollectionPlan"("plannedDate", "status");
CREATE INDEX "CustomerCollectionPlan_parentPlanId_idx" ON "CustomerCollectionPlan"("parentPlanId");
CREATE INDEX "CustomerReceipt_customerPartyId_receivedAt_status_idx" ON "CustomerReceipt"("customerPartyId", "receivedAt", "status");
CREATE INDEX "CustomerReceipt_collectionPlanId_idx" ON "CustomerReceipt"("collectionPlanId");

ALTER TABLE "ReceivableAllocation"
  ADD CONSTRAINT "ReceivableAllocation_customerReceiptId_fkey"
  FOREIGN KEY ("customerReceiptId") REFERENCES "CustomerReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCollectionPlan"
  ADD CONSTRAINT "CustomerCollectionPlan_customerPartyId_fkey"
  FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerCollectionPlan"
  ADD CONSTRAINT "CustomerCollectionPlan_parentPlanId_fkey"
  FOREIGN KEY ("parentPlanId") REFERENCES "CustomerCollectionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerReceipt"
  ADD CONSTRAINT "CustomerReceipt_customerPartyId_fkey"
  FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerReceipt"
  ADD CONSTRAINT "CustomerReceipt_collectionPlanId_fkey"
  FOREIGN KEY ("collectionPlanId") REFERENCES "CustomerCollectionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerReceipt"
  ADD CONSTRAINT "CustomerReceipt_bankTransactionId_fkey"
  FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CreditLimitProposal"
  ADD CONSTRAINT "CreditLimitProposal_customerId_fkey"
  FOREIGN KEY ("customerId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
