DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermPurchaseFlowType') THEN
        CREATE TYPE "TermPurchaseFlowType" AS ENUM ('ESTIMATE_FIRST', 'DIRECT_ORDER');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermPaymentRequestStatus') THEN
        CREATE TYPE "TermPaymentRequestStatus" AS ENUM ('DRAFT', 'APPROVED', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermBankInstructionStatus') THEN
        CREATE TYPE "TermBankInstructionStatus" AS ENUM ('DRAFT', 'SENT', 'MATCHED', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermSettlementAdjustmentType') THEN
        CREATE TYPE "TermSettlementAdjustmentType" AS ENUM ('ADDITIONAL_PAYMENT', 'REFUND', 'NO_ADJUSTMENT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermSettlementAdjustmentStatus') THEN
        CREATE TYPE "TermSettlementAdjustmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'CANCELLED');
    END IF;
END $$;

ALTER TABLE "PurchaseOrder"
ADD COLUMN IF NOT EXISTS "termFlowType" "TermPurchaseFlowType" NOT NULL DEFAULT 'ESTIMATE_FIRST';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseTermOrderDocument_purchaseOrderId_fkey'
    ) THEN
        ALTER TABLE "PurchaseTermOrderDocument"
        ADD CONSTRAINT "PurchaseTermOrderDocument_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseTermOrderDocument_sourcePricingStageId_fkey'
    ) THEN
        ALTER TABLE "PurchaseTermOrderDocument"
        ADD CONSTRAINT "PurchaseTermOrderDocument_sourcePricingStageId_fkey"
        FOREIGN KEY ("sourcePricingStageId") REFERENCES "PurchasePricingStage"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "PurchaseTermOrderDocument_one_active_per_order_uq"
ON "PurchaseTermOrderDocument"("purchaseOrderId")
WHERE "status" = 'ACTIVE';

CREATE TABLE IF NOT EXISTS "PurchaseTermPaymentRequest" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "orderDocumentId" UUID,
    "sourcePricingStageId" UUID,
    "requestNo" TEXT NOT NULL,
    "requestDate" DATE NOT NULL,
    "supplierName" TEXT NOT NULL,
    "content" TEXT,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "paymentDeadline" DATE,
    "status" "TermPaymentRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermPaymentRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseTermPaymentRequest_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseTermPaymentRequest_orderDocumentId_fkey'
    ) THEN
        ALTER TABLE "PurchaseTermPaymentRequest"
        ADD CONSTRAINT "PurchaseTermPaymentRequest_orderDocumentId_fkey"
        FOREIGN KEY ("orderDocumentId") REFERENCES "PurchaseTermOrderDocument"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'PurchaseTermPaymentRequest_sourcePricingStageId_fkey'
    ) THEN
        ALTER TABLE "PurchaseTermPaymentRequest"
        ADD CONSTRAINT "PurchaseTermPaymentRequest_sourcePricingStageId_fkey"
        FOREIGN KEY ("sourcePricingStageId") REFERENCES "PurchasePricingStage"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "PurchaseTermBankInstruction" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "paymentRequestId" UUID,
    "bankTransactionId" UUID,
    "instructionNo" TEXT,
    "instructionDate" DATE,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "beneficiaryName" TEXT,
    "beneficiaryBankAccount" TEXT,
    "beneficiaryBankName" TEXT,
    "content" TEXT,
    "status" "TermBankInstructionStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermBankInstruction_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseTermBankInstruction_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseTermBankInstruction_paymentRequestId_fkey"
        FOREIGN KEY ("paymentRequestId") REFERENCES "PurchaseTermPaymentRequest"("id")
        ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PurchaseTermBankInstruction_bankTransactionId_fkey"
        FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "PurchaseTermSettlementAdjustment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "finalPricingStageId" UUID,
    "adjustmentType" "TermSettlementAdjustmentType" NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" "TermSettlementAdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseTermSettlementAdjustment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PurchaseTermSettlementAdjustment_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PurchaseTermSettlementAdjustment_finalPricingStageId_fkey"
        FOREIGN KEY ("finalPricingStageId") REFERENCES "PurchasePricingStage"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "PurchaseTermPaymentRequest_purchaseOrderId_status_idx"
ON "PurchaseTermPaymentRequest"("purchaseOrderId", "status");

CREATE INDEX IF NOT EXISTS "PurchaseTermPaymentRequest_orderDocumentId_idx"
ON "PurchaseTermPaymentRequest"("orderDocumentId");

CREATE INDEX IF NOT EXISTS "PurchaseTermPaymentRequest_sourcePricingStageId_idx"
ON "PurchaseTermPaymentRequest"("sourcePricingStageId");

CREATE INDEX IF NOT EXISTS "PurchaseTermPaymentRequest_requestNo_idx"
ON "PurchaseTermPaymentRequest"("requestNo");

CREATE INDEX IF NOT EXISTS "PurchaseTermPaymentRequest_requestDate_idx"
ON "PurchaseTermPaymentRequest"("requestDate");

CREATE INDEX IF NOT EXISTS "PurchaseTermBankInstruction_purchaseOrderId_status_idx"
ON "PurchaseTermBankInstruction"("purchaseOrderId", "status");

CREATE INDEX IF NOT EXISTS "PurchaseTermBankInstruction_paymentRequestId_idx"
ON "PurchaseTermBankInstruction"("paymentRequestId");

CREATE INDEX IF NOT EXISTS "PurchaseTermBankInstruction_bankTransactionId_idx"
ON "PurchaseTermBankInstruction"("bankTransactionId");

CREATE INDEX IF NOT EXISTS "PurchaseTermBankInstruction_instructionNo_idx"
ON "PurchaseTermBankInstruction"("instructionNo");

CREATE INDEX IF NOT EXISTS "PurchaseTermBankInstruction_instructionDate_idx"
ON "PurchaseTermBankInstruction"("instructionDate");

CREATE INDEX IF NOT EXISTS "PurchaseTermSettlementAdjustment_purchaseOrderId_status_idx"
ON "PurchaseTermSettlementAdjustment"("purchaseOrderId", "status");

CREATE INDEX IF NOT EXISTS "PurchaseTermSettlementAdjustment_finalPricingStageId_idx"
ON "PurchaseTermSettlementAdjustment"("finalPricingStageId");

CREATE INDEX IF NOT EXISTS "PurchaseTermSettlementAdjustment_adjustmentType_idx"
ON "PurchaseTermSettlementAdjustment"("adjustmentType");
