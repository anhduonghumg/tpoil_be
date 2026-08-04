-- Sales GĐ 4: reconciliation of ordered vs planned vs actually issued, per line and warehouse
-- (sales-implementation-spec v1.2 §3.6, §7).

CREATE TYPE "SalesReconciliationStatus" AS ENUM ('OPEN', 'MATCHED', 'VARIANCE', 'RESOLVED');

CREATE TABLE "SalesReconciliation" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesOrderId" UUID NOT NULL,
  "status" "SalesReconciliationStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesReconciliation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesReconciliation_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SalesReconciliation_salesOrderId_key" ON "SalesReconciliation"("salesOrderId");
CREATE INDEX "SalesReconciliation_status_idx" ON "SalesReconciliation"("status");

CREATE TABLE "SalesReconciliationLine" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "reconciliationId" UUID NOT NULL,
  "salesOrderLineId" UUID NOT NULL,
  "salesDeliveryId" UUID NOT NULL,
  "salesDeliveryLineId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,

  "orderedQty" DECIMAL(24,6) NOT NULL,
  "plannedQty" DECIMAL(24,6) NOT NULL,
  "warehouseConfirmedQty" DECIMAL(24,6) NOT NULL,
  "docQty" DECIMAL(24,6),
  "actualQty" DECIMAL(24,6) NOT NULL,
  "v15Qty" DECIMAL(24,6),

  "status" "SalesReconciliationStatus" NOT NULL DEFAULT 'OPEN',
  "varianceNote" TEXT,
  "resolvedById" UUID,
  "resolvedAt" TIMESTAMPTZ(6),
  "supersededById" UUID,

  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesReconciliationLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesReconciliationLine_reconciliationId_fkey"
    FOREIGN KEY ("reconciliationId") REFERENCES "SalesReconciliation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesReconciliationLine_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesReconciliationLine_salesDeliveryId_fkey"
    FOREIGN KEY ("salesDeliveryId") REFERENCES "SalesDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesReconciliationLine_salesDeliveryLineId_fkey"
    FOREIGN KEY ("salesDeliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesReconciliationLine_supersededById_fkey"
    FOREIGN KEY ("supersededById") REFERENCES "SalesReconciliationLine"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- One reconciliation line per issued delivery line; a revision line replaces exactly one earlier line.
CREATE UNIQUE INDEX "SalesReconciliationLine_salesDeliveryLineId_key"
  ON "SalesReconciliationLine"("salesDeliveryLineId");
CREATE UNIQUE INDEX "SalesReconciliationLine_supersededById_key"
  ON "SalesReconciliationLine"("supersededById");
CREATE INDEX "SalesReconciliationLine_reconciliationId_status_idx"
  ON "SalesReconciliationLine"("reconciliationId", "status");
CREATE INDEX "SalesReconciliationLine_salesOrderLineId_idx"
  ON "SalesReconciliationLine"("salesOrderLineId");
CREATE INDEX "SalesReconciliationLine_salesDeliveryId_idx"
  ON "SalesReconciliationLine"("salesDeliveryId");

-- A resolved line must say who resolved it and why; matched lines need neither.
ALTER TABLE "SalesReconciliationLine" ADD CONSTRAINT "SalesReconciliationLine_resolution_check" CHECK (
  "status" <> 'RESOLVED' OR ("resolvedById" IS NOT NULL AND "varianceNote" IS NOT NULL)
);
