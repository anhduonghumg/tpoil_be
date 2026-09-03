CREATE TYPE "OpenItemSourceType" AS ENUM ('DOCUMENT', 'OPENING_BALANCE');
CREATE TYPE "ReceivableSettlementType" AS ENUM ('RECEIVABLE', 'CUSTOMER_ADVANCE');
CREATE TYPE "OpeningBalanceBatchStatus" AS ENUM ('DRAFT', 'VALIDATED', 'POSTED', 'REVERSED');
CREATE TYPE "OpeningInventoryLineKind" AS ENUM ('ON_HAND', 'RESERVED', 'BLOCKED', 'EXPECTED');
CREATE TYPE "OpeningDebtSide" AS ENUM ('RECEIVABLE', 'PAYABLE');
CREATE TYPE "OpeningDebtBalanceType" AS ENUM ('DEBT', 'ADVANCE');

ALTER TYPE "InventoryPostingKind" ADD VALUE 'OPENING_BALANCE' BEFORE 'RECEIPT';
ALTER TYPE "CostLayerEntryType" ADD VALUE 'OPENING_BALANCE' BEFORE 'OPEN_PROVISIONAL';

ALTER TABLE "InventoryLot"
ADD COLUMN "openingBalanceLineId" UUID;

ALTER TABLE "InventoryPosting"
ADD COLUMN "openingBalanceBatchId" UUID;

ALTER TABLE "ReceivableOpenItem"
ADD COLUMN "sourceType" "OpenItemSourceType" NOT NULL DEFAULT 'DOCUMENT',
ADD COLUMN "settlementType" "ReceivableSettlementType" NOT NULL DEFAULT 'RECEIVABLE',
ADD COLUMN "legacyReference" TEXT,
ADD COLUMN "openingBalanceLineId" UUID;

ALTER TABLE "PayableOpenItem"
ADD COLUMN "sourceType" "OpenItemSourceType" NOT NULL DEFAULT 'DOCUMENT',
ADD COLUMN "legacyReference" TEXT,
ADD COLUMN "openingBalanceLineId" UUID;

ALTER TABLE "ExpectedSupply"
ADD COLUMN "supplierPartyId" UUID,
ADD COLUMN "releaseCode" "SalesOrderSupplySource";

CREATE INDEX "ExpectedSupply_supplierPartyId_releaseCode_status_idx"
ON "ExpectedSupply"("supplierPartyId", "releaseCode", "status");

CREATE UNIQUE INDEX "InventoryLot_openingBalanceLineId_key"
ON "InventoryLot"("openingBalanceLineId");

CREATE UNIQUE INDEX "InventoryPosting_openingBalanceBatchId_key"
ON "InventoryPosting"("openingBalanceBatchId");

CREATE UNIQUE INDEX "ReceivableOpenItem_openingBalanceLineId_key"
ON "ReceivableOpenItem"("openingBalanceLineId");

CREATE UNIQUE INDEX "PayableOpenItem_openingBalanceLineId_key"
ON "PayableOpenItem"("openingBalanceLineId");

CREATE TABLE "OpeningBalanceBatch" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchNo" TEXT NOT NULL,
    "legalEntityId" UUID NOT NULL,
    "cutoverDate" DATE NOT NULL,
    "sourceSystem" TEXT,
    "sourceFileName" TEXT,
    "note" TEXT,
    "status" "OpeningBalanceBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "validationSummary" JSONB,
    "createdById" UUID,
    "validatedById" UUID,
    "validatedAt" TIMESTAMPTZ(6),
    "postedById" UUID,
    "postedAt" TIMESTAMPTZ(6),
    "reversedById" UUID,
    "reversedAt" TIMESTAMPTZ(6),
    "postedInventoryPostingId" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OpeningBalanceBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpeningBalanceInventoryLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "kind" "OpeningInventoryLineKind" NOT NULL,
    "warehouseId" UUID,
    "warehouseAreaId" UUID,
    "productId" UUID NOT NULL,
    "ownerPartyId" UUID NOT NULL,
    "supplierPartyId" UUID,
    "customerPartyId" UUID,
    "releaseCode" "SalesOrderSupplySource",
    "legacyLotNo" TEXT,
    "legacyReference" TEXT,
    "receivedAt" TIMESTAMPTZ(6),
    "expectedAt" TIMESTAMPTZ(6),
    "expiresAt" TIMESTAMPTZ(6),
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "unitCost" DECIMAL(24,6),
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "reason" TEXT,
    "note" TEXT,
    "postedInventoryLotId" UUID,
    "postedReservationId" UUID,
    "postedBlockId" UUID,
    "postedExpectedSupplyId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OpeningBalanceInventoryLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OpeningBalanceDebtLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "batchId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "side" "OpeningDebtSide" NOT NULL,
    "balanceType" "OpeningDebtBalanceType" NOT NULL DEFAULT 'DEBT',
    "counterpartyPartyId" UUID NOT NULL,
    "accountantEmployeeId" UUID,
    "legacyDocumentNo" TEXT,
    "legacyReference" TEXT,
    "documentDate" DATE,
    "dueDate" DATE,
    "currency" CHAR(3) NOT NULL DEFAULT 'VND',
    "originalAmount" DECIMAL(24,4) NOT NULL,
    "settledAmount" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "outstandingAmount" DECIMAL(24,4) NOT NULL,
    "note" TEXT,
    "postedOpenItemId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "OpeningBalanceDebtLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpeningBalanceBatch_batchNo_key"
ON "OpeningBalanceBatch"("batchNo");
CREATE INDEX "OpeningBalanceBatch_status_cutoverDate_idx"
ON "OpeningBalanceBatch"("status", "cutoverDate");
CREATE INDEX "OpeningBalanceBatch_legalEntityId_cutoverDate_idx"
ON "OpeningBalanceBatch"("legalEntityId", "cutoverDate");

CREATE UNIQUE INDEX "OpeningBalanceInventoryLine_batchId_lineNo_key"
ON "OpeningBalanceInventoryLine"("batchId", "lineNo");
CREATE INDEX "OpeningBalanceInventoryLine_batchId_kind_idx"
ON "OpeningBalanceInventoryLine"("batchId", "kind");
CREATE INDEX "OpeningBalanceInventoryLine_warehouseId_productId_idx"
ON "OpeningBalanceInventoryLine"("warehouseId", "productId");
CREATE INDEX "OpeningBalanceInventoryLine_warehouseAreaId_productId_idx"
ON "OpeningBalanceInventoryLine"("warehouseAreaId", "productId");

CREATE UNIQUE INDEX "OpeningBalanceDebtLine_batchId_side_lineNo_key"
ON "OpeningBalanceDebtLine"("batchId", "side", "lineNo");
CREATE INDEX "OpeningBalanceDebtLine_batchId_side_idx"
ON "OpeningBalanceDebtLine"("batchId", "side");
CREATE INDEX "OpeningBalanceDebtLine_counterpartyPartyId_dueDate_idx"
ON "OpeningBalanceDebtLine"("counterpartyPartyId", "dueDate");

ALTER TABLE "OpeningBalanceInventoryLine"
ADD CONSTRAINT "OpeningBalanceInventoryLine_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "OpeningBalanceBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OpeningBalanceDebtLine"
ADD CONSTRAINT "OpeningBalanceDebtLine_batchId_fkey"
FOREIGN KEY ("batchId") REFERENCES "OpeningBalanceBatch"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
