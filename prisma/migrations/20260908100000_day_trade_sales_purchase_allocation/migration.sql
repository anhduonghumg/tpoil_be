CREATE TABLE "SalesPurchaseAllocation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "salesOrderLineId" UUID NOT NULL,
    "purchaseOrderLineId" UUID NOT NULL,
    "allocatedQty" DECIMAL(24,6) NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesPurchaseAllocation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesPurchaseAllocation_salesOrderLineId_purchaseOrderLineId_key"
    ON "SalesPurchaseAllocation"("salesOrderLineId", "purchaseOrderLineId");
CREATE INDEX "SalesPurchaseAllocation_salesOrderLineId_idx"
    ON "SalesPurchaseAllocation"("salesOrderLineId");
CREATE INDEX "SalesPurchaseAllocation_purchaseOrderLineId_idx"
    ON "SalesPurchaseAllocation"("purchaseOrderLineId");

ALTER TABLE "SalesPurchaseAllocation"
    ADD CONSTRAINT "SalesPurchaseAllocation_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesPurchaseAllocation"
    ADD CONSTRAINT "SalesPurchaseAllocation_purchaseOrderLineId_fkey"
    FOREIGN KEY ("purchaseOrderLineId") REFERENCES "PurchaseOrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesPurchaseAllocation"
    ADD CONSTRAINT "SalesPurchaseAllocation_allocatedQty_check"
    CHECK ("allocatedQty" > 0);
