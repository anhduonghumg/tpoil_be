-- Sales GĐ 2: per-line holds, per-warehouse delivery jobs, versioned work items
-- (sales-implementation-spec v1.2 §3.2, §3.3, §8.1, D6)

-- 1) Warehouse can hand a delivery job back to sales instead of editing sales data
ALTER TYPE "SalesDeliveryStatus" ADD VALUE IF NOT EXISTS 'RETURNED';

-- 2) Reservation lines point back at the sales order line they cover, so "đang giữ"
--    is computable per line even when several holds share warehouse+product+owner.
ALTER TABLE "InventoryReservationLine" ADD COLUMN "salesOrderLineId" UUID;

ALTER TABLE "InventoryReservationLine"
  ADD CONSTRAINT "InventoryReservationLine_salesOrderLineId_fkey"
  FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryReservationLine_salesOrderLineId_idx"
  ON "InventoryReservationLine"("salesOrderLineId");

-- 3) SINGLE lines may only be fulfilled once — the pointer IS the constraint (P0-2).
ALTER TABLE "SalesOrderLine" ADD COLUMN "effectiveDeliveryLineId" UUID;

CREATE UNIQUE INDEX "SalesOrderLine_effectiveDeliveryLineId_key"
  ON "SalesOrderLine"("effectiveDeliveryLineId");

-- 4) SalesDelivery = one warehouse's share of the work
ALTER TABLE "SalesDelivery"
  ADD COLUMN "vehiclePlate" TEXT,
  ADD COLUMN "driverName" TEXT,
  ADD COLUMN "vehicleId" UUID,
  ADD COLUMN "driverId" UUID,
  ADD COLUMN "issueDocNo" TEXT,
  ADD COLUMN "sourceFileName" TEXT,
  ADD COLUMN "sourceFileUrl" TEXT,
  ADD COLUMN "confirmedById" UUID,
  ADD COLUMN "confirmedAt" TIMESTAMPTZ(6),
  ADD COLUMN "returnedReason" TEXT,
  ADD COLUMN "returnedById" UUID,
  ADD COLUMN "returnedAt" TIMESTAMPTZ(6),
  ADD COLUMN "revisionOfId" UUID,
  ADD COLUMN "createdById" UUID;

ALTER TABLE "SalesDelivery"
  ADD CONSTRAINT "SalesDelivery_vehicleId_fkey"
    FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesDelivery_driverId_fkey"
    FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "SalesDelivery_revisionOfId_fkey"
    FOREIGN KEY ("revisionOfId") REFERENCES "SalesDelivery"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "SalesDelivery_revisionOfId_key" ON "SalesDelivery"("revisionOfId");
CREATE INDEX "SalesDelivery_vehicleId_idx" ON "SalesDelivery"("vehicleId");
CREATE INDEX "SalesDelivery_driverId_idx" ON "SalesDelivery"("driverId");

-- 5) Delivery lines: planned vs confirmed. actualQty becomes nullable —
--    null = warehouse has not confirmed yet, 0 = confirmed that nothing was issued (P0-4).
ALTER TABLE "SalesDeliveryLine"
  ADD COLUMN "plannedActualQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
  ADD COLUMN "plannedV15Qty" DECIMAL(24,6),
  ADD COLUMN "temperatureC" DECIMAL(8,3),
  ADD COLUMN "vcf" DECIMAL(14,8),
  ADD COLUMN "postedAt" TIMESTAMPTZ(6),
  ALTER COLUMN "actualQty" DROP NOT NULL;

-- 6) Work item version ordering (D6): a late event must not reopen a newer state.
ALTER TABLE "NotificationWorkItem" ADD COLUMN "sourceVersion" INTEGER;
