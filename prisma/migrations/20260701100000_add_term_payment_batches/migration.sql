DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermPaymentBatchStatus') THEN
        CREATE TYPE "TermPaymentBatchStatus" AS ENUM ('DRAFT', 'SENT_TO_BANK', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermPaymentBatchItemStatus') THEN
        CREATE TYPE "TermPaymentBatchItemStatus" AS ENUM ('PENDING', 'SENT', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'CANCELLED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TermPaymentBatchFileType') THEN
        CREATE TYPE "TermPaymentBatchFileType" AS ENUM ('EXPORTED_LIST', 'BANK_RETURN', 'UNC', 'OTHER');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS "TermPaymentBatch" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchNo" TEXT NOT NULL,
    "batchDate" DATE NOT NULL,
    "bankAccountId" UUID,
    "totalAmountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "status" "TermPaymentBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermPaymentBatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TermPaymentBatch_bankAccountId_fkey"
        FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TermPaymentBatchItem" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "paymentRequestId" UUID NOT NULL,
    "purchaseOrderId" UUID NOT NULL,
    "bankTransactionId" UUID,
    "supplierName" TEXT NOT NULL,
    "amountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paidAmountVnd" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "beneficiaryName" TEXT,
    "beneficiaryBankAccount" TEXT,
    "beneficiaryBankName" TEXT,
    "transferContent" TEXT,
    "status" "TermPaymentBatchItemStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermPaymentBatchItem_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TermPaymentBatchItem_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "TermPaymentBatch"("id")
        ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "TermPaymentBatchItem_paymentRequestId_fkey"
        FOREIGN KEY ("paymentRequestId") REFERENCES "PurchaseTermPaymentRequest"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TermPaymentBatchItem_purchaseOrderId_fkey"
        FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "TermPaymentBatchItem_bankTransactionId_fkey"
        FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id")
        ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "TermPaymentBatchFile" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "fileType" "TermPaymentBatchFileType" NOT NULL DEFAULT 'OTHER',
    "fileName" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileChecksum" TEXT,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermPaymentBatchFile_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TermPaymentBatchFile_batchId_fkey"
        FOREIGN KEY ("batchId") REFERENCES "TermPaymentBatch"("id")
        ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "TermPaymentBatch_batchNo_key"
ON "TermPaymentBatch"("batchNo");

CREATE INDEX IF NOT EXISTS "TermPaymentBatch_batchDate_idx"
ON "TermPaymentBatch"("batchDate");

CREATE INDEX IF NOT EXISTS "TermPaymentBatch_bankAccountId_status_idx"
ON "TermPaymentBatch"("bankAccountId", "status");

CREATE INDEX IF NOT EXISTS "TermPaymentBatch_status_createdAt_idx"
ON "TermPaymentBatch"("status", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "TermPaymentBatchItem_batchId_paymentRequestId_key"
ON "TermPaymentBatchItem"("batchId", "paymentRequestId");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchItem_paymentRequestId_status_idx"
ON "TermPaymentBatchItem"("paymentRequestId", "status");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchItem_purchaseOrderId_status_idx"
ON "TermPaymentBatchItem"("purchaseOrderId", "status");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchItem_bankTransactionId_idx"
ON "TermPaymentBatchItem"("bankTransactionId");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchItem_status_idx"
ON "TermPaymentBatchItem"("status");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchFile_batchId_fileType_idx"
ON "TermPaymentBatchFile"("batchId", "fileType");

CREATE INDEX IF NOT EXISTS "TermPaymentBatchFile_fileChecksum_idx"
ON "TermPaymentBatchFile"("fileChecksum");
