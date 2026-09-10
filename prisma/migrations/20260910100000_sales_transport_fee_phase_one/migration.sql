-- Phase 1: commercial transport fee on retail sales orders.
-- Sales stays independent; this table is only the operations work queue.

CREATE TYPE "SalesTransportRequestStatus" AS ENUM ('NEW', 'ACKNOWLEDGED', 'CANCELLED');

ALTER TABLE "SalesOrder"
  ADD COLUMN "hasTransportFee" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "transportVehiclePlate" TEXT,
  ADD COLUMN "transportDriverName" TEXT;

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "isTransportFeeApplicable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "transportFeeUnitPrice" DECIMAL(24,8) NOT NULL DEFAULT 0;

CREATE INDEX "SalesOrderLine_isTransportFeeApplicable_idx"
  ON "SalesOrderLine"("isTransportFeeApplicable");

CREATE TABLE "SalesOrderTransportRequest" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesOrderId" UUID NOT NULL,
  "status" "SalesTransportRequestStatus" NOT NULL DEFAULT 'NEW',
  "plannedVehiclePlate" TEXT,
  "plannedDriverName" TEXT,
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SalesOrderTransportRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesOrderTransportRequest_salesOrderId_key"
  ON "SalesOrderTransportRequest"("salesOrderId");
CREATE INDEX "SalesOrderTransportRequest_status_requestedAt_idx"
  ON "SalesOrderTransportRequest"("status", "requestedAt");

ALTER TABLE "SalesOrderTransportRequest"
  ADD CONSTRAINT "SalesOrderTransportRequest_salesOrderId_fkey"
  FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
