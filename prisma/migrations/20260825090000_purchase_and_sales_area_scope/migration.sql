-- An order may be scoped to a warehouse area while the exact depot is intentionally unknown.
-- Existing commercial positions stay warehouse-scoped.
ALTER TABLE "CommercialLotPosition"
    ALTER COLUMN "plannedWarehouseId" DROP NOT NULL,
    ADD COLUMN "plannedWarehouseAreaId" UUID;

CREATE INDEX "CommercialLotPosition_plannedWarehouseAreaId_productId_idx"
    ON "CommercialLotPosition"("plannedWarehouseAreaId", "productId");

ALTER TABLE "CommercialLotPosition"
    ADD CONSTRAINT "CommercialLotPosition_plannedWarehouseAreaId_fkey"
    FOREIGN KEY ("plannedWarehouseAreaId") REFERENCES "WarehouseArea"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "CommercialLotPosition"
    ADD CONSTRAINT "CommercialLotPosition_location_scope_check"
    CHECK (num_nonnulls("plannedWarehouseId", "plannedWarehouseAreaId") = 1);

ALTER TABLE "SalesOrderLine"
    ADD COLUMN "receivingWarehouseAreaId" UUID;

CREATE INDEX "SalesOrderLine_receivingWarehouseAreaId_idx"
    ON "SalesOrderLine"("receivingWarehouseAreaId");

ALTER TABLE "SalesOrderLine"
    ADD CONSTRAINT "SalesOrderLine_receivingWarehouseAreaId_fkey"
    FOREIGN KEY ("receivingWarehouseAreaId") REFERENCES "WarehouseArea"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
