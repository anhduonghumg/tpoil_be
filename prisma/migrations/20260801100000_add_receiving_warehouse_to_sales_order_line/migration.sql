-- Sales records where the customer wants the goods delivered, plus the truck details they gave.
ALTER TABLE "SalesOrderLine" ADD COLUMN "receivingWarehouseId" UUID;
ALTER TABLE "SalesOrderLine" ADD COLUMN "vehiclePlate" TEXT;
ALTER TABLE "SalesOrderLine" ADD COLUMN "driverName" TEXT;
ALTER TABLE "SalesOrderLine" ADD COLUMN "discountAmount" DECIMAL(24,8) NOT NULL DEFAULT 0;

CREATE INDEX "SalesOrderLine_receivingWarehouseId_idx" ON "SalesOrderLine"("receivingWarehouseId");

ALTER TABLE "SalesOrderLine"
    ADD CONSTRAINT "SalesOrderLine_receivingWarehouseId_fkey"
    FOREIGN KEY ("receivingWarehouseId") REFERENCES "Warehouse"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
