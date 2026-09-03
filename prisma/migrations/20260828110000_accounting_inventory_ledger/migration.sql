-- Accounting stock is intentionally independent from the physical StockBalance ledger.
CREATE TYPE "AccountingInventoryPostingKind" AS ENUM (
    'PURCHASE_INVOICE',
    'SALES_INVOICE',
    'INVOICE_REVERSAL'
);

CREATE TABLE "AccountingInventoryPosting" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "postingNo" TEXT NOT NULL,
    "kind" "AccountingInventoryPostingKind" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "reversalOfId" UUID,
    "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
    "postedById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingInventoryPosting_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountingInventoryEntry" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "postingId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "sourceLineId" UUID,
    "legalEntityId" UUID NOT NULL,
    "warehouseId" UUID,
    "warehouseAreaId" UUID,
    "productId" UUID NOT NULL,
    "supplierPartyId" UUID NOT NULL,
    "releaseCode" "SalesOrderSupplySource" NOT NULL,
    "qtyDelta" DECIMAL(24,6) NOT NULL,
    "valueDelta" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountingInventoryEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccountingInventoryEntry_location_check" CHECK (
        ("warehouseId" IS NOT NULL AND "warehouseAreaId" IS NULL)
        OR ("warehouseId" IS NULL AND "warehouseAreaId" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "AccountingInventoryPosting_postingNo_key"
    ON "AccountingInventoryPosting"("postingNo");
CREATE UNIQUE INDEX "AccountingInventoryPosting_idempotencyKey_key"
    ON "AccountingInventoryPosting"("idempotencyKey");
CREATE UNIQUE INDEX "AccountingInventoryPosting_reversalOfId_key"
    ON "AccountingInventoryPosting"("reversalOfId");
CREATE INDEX "AccountingInventoryPosting_sourceType_sourceId_idx"
    ON "AccountingInventoryPosting"("sourceType", "sourceId");
CREATE INDEX "AccountingInventoryPosting_effectiveAt_idx"
    ON "AccountingInventoryPosting"("effectiveAt");

CREATE UNIQUE INDEX "AccountingInventoryEntry_postingId_lineNo_key"
    ON "AccountingInventoryEntry"("postingId", "lineNo");
CREATE INDEX "AccountingInventoryEntry_warehouse_scope_idx"
    ON "AccountingInventoryEntry"("legalEntityId", "warehouseId", "productId", "supplierPartyId", "releaseCode");
CREATE INDEX "AccountingInventoryEntry_area_scope_idx"
    ON "AccountingInventoryEntry"("legalEntityId", "warehouseAreaId", "productId", "supplierPartyId", "releaseCode");
CREATE INDEX "AccountingInventoryEntry_sourceLineId_idx"
    ON "AccountingInventoryEntry"("sourceLineId");

ALTER TABLE "AccountingInventoryPosting"
    ADD CONSTRAINT "AccountingInventoryPosting_reversalOfId_fkey"
    FOREIGN KEY ("reversalOfId") REFERENCES "AccountingInventoryPosting"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AccountingInventoryEntry"
    ADD CONSTRAINT "AccountingInventoryEntry_postingId_fkey"
    FOREIGN KEY ("postingId") REFERENCES "AccountingInventoryPosting"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
