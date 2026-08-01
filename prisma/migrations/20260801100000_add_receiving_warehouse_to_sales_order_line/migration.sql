-- Sales records where the customer wants the goods delivered.
ALTER TABLE "SalesOrderLine" ADD COLUMN "receivingWarehouseId" UUID;

CREATE INDEX "SalesOrderLine_receivingWarehouseId_idx" ON "SalesOrderLine"("receivingWarehouseId");

ALTER TABLE "SalesOrderLine"
    ADD CONSTRAINT "SalesOrderLine_receivingWarehouseId_fkey"
    FOREIGN KEY ("receivingWarehouseId") REFERENCES "Warehouse"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
