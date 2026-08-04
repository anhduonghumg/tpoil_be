-- Sales GĐ 3: the exact lots issued for a delivery line.
-- One source of truth shared by inventory posting, reservation consumption, cost consumption,
-- purchase-source tracing and profitability (spec v1.2 nguyên tắc 10).

CREATE TABLE "SalesDeliveryLotAllocation" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "salesDeliveryLineId" UUID NOT NULL,
  "inventoryLotId" UUID NOT NULL,
  "ownerPartyId" UUID NOT NULL,
  "actualQty" DECIMAL(24,6) NOT NULL,
  "v15Qty" DECIMAL(24,6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "SalesDeliveryLotAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SalesDeliveryLotAllocation_salesDeliveryLineId_fkey"
    FOREIGN KEY ("salesDeliveryLineId") REFERENCES "SalesDeliveryLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesDeliveryLotAllocation_inventoryLotId_fkey"
    FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "SalesDeliveryLotAllocation_ownerPartyId_fkey"
    FOREIGN KEY ("ownerPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SalesDeliveryLotAllocation_salesDeliveryLineId_inventoryLot_key"
  ON "SalesDeliveryLotAllocation"("salesDeliveryLineId", "inventoryLotId");
CREATE INDEX "SalesDeliveryLotAllocation_inventoryLotId_idx"
  ON "SalesDeliveryLotAllocation"("inventoryLotId");
CREATE INDEX "SalesDeliveryLotAllocation_ownerPartyId_idx"
  ON "SalesDeliveryLotAllocation"("ownerPartyId");
