-- Sales workflow foundation (sales-implementation-spec v1.2, GĐ 0+1)
-- 1) New enums for the internal sales flow
CREATE TYPE "SalesOrderKind" AS ENUM ('DAY_TRADE', 'SINGLE', 'LOT');
CREATE TYPE "SalesApprovalType" AS ENUM ('PRICE', 'CREDIT', 'EXCEPTION');
CREATE TYPE "SalesApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'STALE', 'CANCELLED');

-- 2) Extend SalesOrderStatus (values only added, nothing removed)
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_STOCK';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'WAREHOUSE_PROCESSING';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'DELIVERED';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_RECONCILIATION';
ALTER TYPE "SalesOrderStatus" ADD VALUE IF NOT EXISTS 'AWAITING_INVOICE';

-- 3) SalesOrder: kind + contract/payment terms + approval workflow columns
ALTER TABLE "SalesOrder"
  ADD COLUMN "kind" "SalesOrderKind" NOT NULL DEFAULT 'DAY_TRADE',
  ADD COLUMN "contractId" UUID,
  ADD COLUMN "paymentTermType" "PaymentTermType" NOT NULL DEFAULT 'SAME_DAY',
  ADD COLUMN "paymentTermDays" INTEGER,
  ADD COLUMN "approvalCycle" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "policySnapshot" JSONB,
  ADD COLUMN "createdById" UUID,
  ADD COLUMN "submittedById" UUID,
  ADD COLUMN "submittedAt" TIMESTAMPTZ(6),
  ADD COLUMN "approvedById" UUID,
  ADD COLUMN "approvedAt" TIMESTAMPTZ(6),
  ADD COLUMN "rejectedReason" TEXT,
  ADD COLUMN "cancelledById" UUID,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(6);

ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesOrder_kind_status_idx" ON "SalesOrder"("kind", "status");
CREATE INDEX "SalesOrder_contractId_idx" ON "SalesOrder"("contractId");

-- 4) SalesOrderLine: dedicated issue warehouse for SINGLE/LOT (D9 — receivingWarehouseId keeps DAY_TRADE meaning)
ALTER TABLE "SalesOrderLine" ADD COLUMN "issueWarehouseId" UUID;

ALTER TABLE "SalesOrderLine"
  ADD CONSTRAINT "SalesOrderLine_issueWarehouseId_fkey"
  FOREIGN KEY ("issueWarehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "SalesOrderLine_issueWarehouseId_idx" ON "SalesOrderLine"("issueWarehouseId");

-- 5) Parallel approval requests
CREATE TABLE "SalesApprovalRequest" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesOrderId" UUID NOT NULL,
  "approvalCycle" INTEGER NOT NULL,
  "type" "SalesApprovalType" NOT NULL,
  "status" "SalesApprovalStatus" NOT NULL DEFAULT 'PENDING',
  "reasonDetail" JSONB,
  "requestedById" UUID,
  "decidedById" UUID,
  "decidedAt" TIMESTAMPTZ(6),
  "decisionNote" TEXT,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "SalesApprovalRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesApprovalRequest_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SalesApprovalRequest_salesOrderId_approvalCycle_status_idx"
  ON "SalesApprovalRequest"("salesOrderId", "approvalCycle", "status");
CREATE INDEX "SalesApprovalRequest_status_type_idx" ON "SalesApprovalRequest"("status", "type");

-- GĐ 0 constraint: at most one PENDING request per (target, cycle, type)
CREATE UNIQUE INDEX "uq_sales_approval_pending"
  ON "SalesApprovalRequest"("salesOrderId", "approvalCycle", "type")
  WHERE "status" = 'PENDING';

-- 6) Append-only business workflow audit
CREATE TABLE "SalesWorkflowEvent" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "entityType" TEXT NOT NULL,
  "entityId" UUID NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromStatus" TEXT,
  "toStatus" TEXT,
  "actorId" UUID,
  "reason" TEXT,
  "version" INTEGER,
  "cycle" INTEGER,
  "metadata" JSONB,
  "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesWorkflowEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesWorkflowEvent_entityType_entityId_occurredAt_idx"
  ON "SalesWorkflowEvent"("entityType", "entityId", "occurredAt");
