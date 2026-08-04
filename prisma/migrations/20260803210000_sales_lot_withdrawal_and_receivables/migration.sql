-- Sales GĐ 5: LOT positions, withdrawal requests, lot adjustments
-- + Accounts receivable ledger (mirror of the payable side).
-- sales-implementation-spec v1.2 §3.4, §3.8, §4.2, §4.3, §6.

CREATE TYPE "SalesWithdrawalStatus" AS ENUM (
  'DRAFT', 'NEED_SOURCE', 'PENDING_REVIEW', 'APPROVED', 'RESERVED',
  'WAREHOUSE_PROCESSING', 'ISSUED', 'REJECTED', 'CANCELLED'
);
CREATE TYPE "ReceivableOpenItemStatus" AS ENUM ('OPEN', 'PARTIALLY_SETTLED', 'SETTLED', 'VOIDED');
CREATE TYPE "ReceivableEntryType" AS ENUM ('OPEN', 'RECEIPT', 'CREDIT_NOTE', 'FX_DIFFERENCE', 'REVERSAL');
CREATE TYPE "ReceivableAllocationStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- =========================================================
-- 1) Remaining draw balance of a LOT order line
-- =========================================================
CREATE TABLE "SalesLotPosition" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesOrderLineId" UUID NOT NULL,
  "totalQty" DECIMAL(24,6) NOT NULL,
  "issuedQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "adjustedQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesLotPosition_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesLotPosition_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Only the warehouse can move issuedQty, and never past the commitment.
  CONSTRAINT "SalesLotPosition_quantity_check" CHECK (
    "totalQty" > 0 AND "issuedQty" >= 0 AND "adjustedQty" >= 0
    AND ("issuedQty" + "adjustedQty") <= "totalQty"
  )
);
CREATE UNIQUE INDEX "SalesLotPosition_salesOrderLineId_key" ON "SalesLotPosition"("salesOrderLineId");

CREATE TABLE "SalesLotAdjustment" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesLotPositionId" UUID NOT NULL,
  "qty" DECIMAL(24,6) NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "SalesApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "requestedById" UUID,
  "decidedById" UUID,
  "decidedAt" TIMESTAMPTZ(6),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesLotAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesLotAdjustment_salesLotPositionId_fkey"
    FOREIGN KEY ("salesLotPositionId") REFERENCES "SalesLotPosition"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotAdjustment_qty_check" CHECK ("qty" > 0)
);
CREATE INDEX "SalesLotAdjustment_salesLotPositionId_status_idx"
  ON "SalesLotAdjustment"("salesLotPositionId", "status");

-- =========================================================
-- 2) Withdrawal requests against a LOT order
-- =========================================================
CREATE TABLE "SalesLotWithdrawalRequest" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "requestNo" TEXT NOT NULL,
  "customerPartyId" UUID NOT NULL,
  "salesOrderId" UUID,
  "status" "SalesWithdrawalStatus" NOT NULL DEFAULT 'DRAFT',
  "vehiclePlate" TEXT,
  "driverName" TEXT,
  "vehicleId" UUID,
  "driverId" UUID,
  "requestDate" DATE NOT NULL,
  "note" TEXT,
  "approvalCycle" INTEGER NOT NULL DEFAULT 0,
  "createdById" UUID,
  "submittedById" UUID,
  "submittedAt" TIMESTAMPTZ(6),
  "approvedById" UUID,
  "approvedAt" TIMESTAMPTZ(6),
  "rejectedReason" TEXT,
  "cancelledById" UUID,
  "cancelledAt" TIMESTAMPTZ(6),
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesLotWithdrawalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesLotWithdrawalRequest_customerPartyId_fkey"
    FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequest_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequest_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequest_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  -- Only a request still looking for its source may be missing the lot order.
  CONSTRAINT "SalesLotWithdrawalRequest_source_check" CHECK (
    "salesOrderId" IS NOT NULL OR "status" IN ('DRAFT', 'NEED_SOURCE', 'CANCELLED')
  )
);
CREATE UNIQUE INDEX "SalesLotWithdrawalRequest_requestNo_key" ON "SalesLotWithdrawalRequest"("requestNo");
CREATE INDEX "SalesLotWithdrawalRequest_customerPartyId_status_idx"
  ON "SalesLotWithdrawalRequest"("customerPartyId", "status");
CREATE INDEX "SalesLotWithdrawalRequest_salesOrderId_status_idx"
  ON "SalesLotWithdrawalRequest"("salesOrderId", "status");

CREATE TABLE "SalesLotWithdrawalRequestLine" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "requestId" UUID NOT NULL,
  "lineNo" INTEGER NOT NULL,
  "salesOrderLineId" UUID,
  "productId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "requestedQty" DECIMAL(24,6) NOT NULL,
  "requestedV15Qty" DECIMAL(24,6),

  CONSTRAINT "SalesLotWithdrawalRequestLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesLotWithdrawalRequestLine_requestId_fkey"
    FOREIGN KEY ("requestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequestLine_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequestLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequestLine_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesLotWithdrawalRequestLine_qty_check" CHECK ("requestedQty" > 0)
);
CREATE UNIQUE INDEX "SalesLotWithdrawalRequestLine_requestId_lineNo_key"
  ON "SalesLotWithdrawalRequestLine"("requestId", "lineNo");
CREATE INDEX "SalesLotWithdrawalRequestLine_salesOrderLineId_idx"
  ON "SalesLotWithdrawalRequestLine"("salesOrderLineId");

-- =========================================================
-- 3) Link withdrawals into deliveries, holds, approvals, reconciliation
-- =========================================================
ALTER TABLE "SalesDelivery" ADD COLUMN "withdrawalRequestId" UUID;
ALTER TABLE "SalesDelivery"
  ADD CONSTRAINT "SalesDelivery_withdrawalRequestId_fkey"
  FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SalesDelivery_withdrawalRequestId_idx" ON "SalesDelivery"("withdrawalRequestId");

ALTER TABLE "InventoryReservation" ADD COLUMN "withdrawalRequestId" UUID;
ALTER TABLE "InventoryReservation"
  ADD CONSTRAINT "InventoryReservation_withdrawalRequestId_fkey"
  FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InventoryReservation_withdrawalRequestId_idx" ON "InventoryReservation"("withdrawalRequestId");

-- A hold must still cite a source; a withdrawal request now counts as one.
ALTER TABLE "InventoryReservation" DROP CONSTRAINT IF EXISTS "InventoryReservation_source_check";
ALTER TABLE "InventoryReservation" ADD CONSTRAINT "InventoryReservation_source_check" CHECK (
  "salesOrderId" IS NOT NULL OR "withdrawalRequestId" IS NOT NULL OR "manualReference" IS NOT NULL
);

ALTER TABLE "InventoryReservationLine" ADD COLUMN "withdrawalRequestLineId" UUID;
ALTER TABLE "InventoryReservationLine"
  ADD CONSTRAINT "InventoryReservationLine_withdrawalRequestLineId_fkey"
  FOREIGN KEY ("withdrawalRequestLineId") REFERENCES "SalesLotWithdrawalRequestLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InventoryReservationLine_withdrawalRequestLineId_idx"
  ON "InventoryReservationLine"("withdrawalRequestLineId");

-- Approvals become dual-target (order XOR withdrawal).
ALTER TABLE "SalesApprovalRequest" ALTER COLUMN "salesOrderId" DROP NOT NULL;
ALTER TABLE "SalesApprovalRequest" ADD COLUMN "withdrawalRequestId" UUID;
ALTER TABLE "SalesApprovalRequest"
  ADD CONSTRAINT "SalesApprovalRequest_withdrawalRequestId_fkey"
  FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesApprovalRequest" ADD CONSTRAINT "SalesApprovalRequest_target_check" CHECK (
  ("salesOrderId" IS NOT NULL AND "withdrawalRequestId" IS NULL)
  OR ("salesOrderId" IS NULL AND "withdrawalRequestId" IS NOT NULL)
);
CREATE INDEX "SalesApprovalRequest_withdrawalRequestId_idx" ON "SalesApprovalRequest"("withdrawalRequestId");
-- One PENDING request per (withdrawal target, cycle, type), same rule as for orders.
CREATE UNIQUE INDEX "uq_sales_approval_pending_withdrawal"
  ON "SalesApprovalRequest"("withdrawalRequestId", "approvalCycle", "type")
  WHERE "status" = 'PENDING' AND "withdrawalRequestId" IS NOT NULL;

-- Reconciliation becomes dual-target too.
ALTER TABLE "SalesReconciliation" ALTER COLUMN "salesOrderId" DROP NOT NULL;
ALTER TABLE "SalesReconciliation" ADD COLUMN "withdrawalRequestId" UUID;
ALTER TABLE "SalesReconciliation"
  ADD CONSTRAINT "SalesReconciliation_withdrawalRequestId_fkey"
  FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "SalesReconciliation_withdrawalRequestId_key"
  ON "SalesReconciliation"("withdrawalRequestId");
ALTER TABLE "SalesReconciliation" ADD CONSTRAINT "SalesReconciliation_target_check" CHECK (
  ("salesOrderId" IS NOT NULL AND "withdrawalRequestId" IS NULL)
  OR ("salesOrderId" IS NULL AND "withdrawalRequestId" IS NOT NULL)
);

-- =========================================================
-- 4) Accounts receivable — mirror of the payable ledger
-- =========================================================
CREATE TABLE "ReceivableOpenItem" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesInvoiceId" UUID,
  "salesOrderId" UUID,
  "withdrawalRequestId" UUID,
  "legalEntityId" UUID NOT NULL,
  "customerPartyId" UUID NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "originalAmount" DECIMAL(24,4) NOT NULL,
  "outstandingAmount" DECIMAL(24,4) NOT NULL,
  "dueDate" DATE,
  "note" TEXT,
  "status" "ReceivableOpenItemStatus" NOT NULL DEFAULT 'OPEN',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "ReceivableOpenItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceivableOpenItem_legalEntityId_fkey"
    FOREIGN KEY ("legalEntityId") REFERENCES "LegalEntity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableOpenItem_customerPartyId_fkey"
    FOREIGN KEY ("customerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableOpenItem_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableOpenItem_withdrawalRequestId_fkey"
    FOREIGN KEY ("withdrawalRequestId") REFERENCES "SalesLotWithdrawalRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  -- Outstanding may never exceed the debt nor go negative.
  CONSTRAINT "ReceivableOpenItem_amount_check" CHECK (
    "originalAmount" > 0 AND "outstandingAmount" >= 0 AND "outstandingAmount" <= "originalAmount"
  ),
  -- Every receivable cites the document it came from.
  CONSTRAINT "ReceivableOpenItem_source_check" CHECK (
    "salesInvoiceId" IS NOT NULL OR "salesOrderId" IS NOT NULL OR "withdrawalRequestId" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "ReceivableOpenItem_salesInvoiceId_key" ON "ReceivableOpenItem"("salesInvoiceId");
CREATE INDEX "ReceivableOpenItem_customerPartyId_status_dueDate_idx"
  ON "ReceivableOpenItem"("customerPartyId", "status", "dueDate");
CREATE INDEX "ReceivableOpenItem_salesOrderId_idx" ON "ReceivableOpenItem"("salesOrderId");
CREATE INDEX "ReceivableOpenItem_withdrawalRequestId_idx" ON "ReceivableOpenItem"("withdrawalRequestId");
-- One live receivable per commercial document.
CREATE UNIQUE INDEX "uq_receivable_open_item_order"
  ON "ReceivableOpenItem"("salesOrderId")
  WHERE "salesOrderId" IS NOT NULL AND "status" <> 'VOIDED';
CREATE UNIQUE INDEX "uq_receivable_open_item_withdrawal"
  ON "ReceivableOpenItem"("withdrawalRequestId")
  WHERE "withdrawalRequestId" IS NOT NULL AND "status" <> 'VOIDED';

CREATE TABLE "ReceivableAllocation" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "bankTransactionId" UUID NOT NULL,
  "openItemId" UUID NOT NULL,
  "amountInBankCurrency" DECIMAL(24,4) NOT NULL,
  "amountInItemCurrency" DECIMAL(24,4) NOT NULL,
  "fxRate" DECIMAL(24,10),
  "status" "ReceivableAllocationStatus" NOT NULL DEFAULT 'ACTIVE',
  "reversalOfId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "allocatedById" UUID,
  "allocatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "ReceivableAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceivableAllocation_bankTransactionId_fkey"
    FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableAllocation_openItemId_fkey"
    FOREIGN KEY ("openItemId") REFERENCES "ReceivableOpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableAllocation_reversalOfId_fkey"
    FOREIGN KEY ("reversalOfId") REFERENCES "ReceivableAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ReceivableAllocation_reversalOfId_key" ON "ReceivableAllocation"("reversalOfId");
CREATE UNIQUE INDEX "ReceivableAllocation_idempotencyKey_key" ON "ReceivableAllocation"("idempotencyKey");
CREATE INDEX "ReceivableAllocation_bankTransactionId_status_idx"
  ON "ReceivableAllocation"("bankTransactionId", "status");
CREATE INDEX "ReceivableAllocation_openItemId_status_idx"
  ON "ReceivableAllocation"("openItemId", "status");

CREATE TABLE "ReceivableLedgerEntry" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "openItemId" UUID NOT NULL,
  "type" "ReceivableEntryType" NOT NULL,
  "amountDelta" DECIMAL(24,4) NOT NULL,
  "allocationId" UUID,
  "reversalOfId" UUID,
  "idempotencyKey" TEXT NOT NULL,
  "effectiveAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ReceivableLedgerEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReceivableLedgerEntry_openItemId_fkey"
    FOREIGN KEY ("openItemId") REFERENCES "ReceivableOpenItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableLedgerEntry_allocationId_fkey"
    FOREIGN KEY ("allocationId") REFERENCES "ReceivableAllocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableLedgerEntry_reversalOfId_fkey"
    FOREIGN KEY ("reversalOfId") REFERENCES "ReceivableLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ReceivableLedgerEntry_amount_check" CHECK ("amountDelta" <> 0),
  CONSTRAINT "ReceivableLedgerEntry_reversal_check" CHECK (
    "type" <> 'REVERSAL' OR "reversalOfId" IS NOT NULL
  )
);
CREATE UNIQUE INDEX "ReceivableLedgerEntry_allocationId_key" ON "ReceivableLedgerEntry"("allocationId");
CREATE UNIQUE INDEX "ReceivableLedgerEntry_reversalOfId_key" ON "ReceivableLedgerEntry"("reversalOfId");
CREATE UNIQUE INDEX "ReceivableLedgerEntry_idempotencyKey_key" ON "ReceivableLedgerEntry"("idempotencyKey");
CREATE INDEX "ReceivableLedgerEntry_openItemId_effectiveAt_idx"
  ON "ReceivableLedgerEntry"("openItemId", "effectiveAt");

-- The receivable ledger is history: correct it with a reversal, never an edit.
CREATE TRIGGER "ReceivableLedgerEntry_immutable"
  BEFORE DELETE OR UPDATE ON "ReceivableLedgerEntry"
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
