-- Retail commercial purchases answer a customer order raised by sales.
ALTER TABLE "PurchaseOrder" ADD COLUMN "salesOrderId" UUID;

CREATE INDEX "PurchaseOrder_salesOrderId_idx" ON "PurchaseOrder"("salesOrderId");

ALTER TABLE "PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
