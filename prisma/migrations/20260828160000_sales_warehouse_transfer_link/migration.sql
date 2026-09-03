ALTER TABLE "InventoryMovement"
    ADD COLUMN "salesOrderId" UUID,
    ADD COLUMN "transferReason" TEXT,
    ADD COLUMN "transferFee" DECIMAL(24,4) NOT NULL DEFAULT 0,
    ADD COLUMN "chargeCustomer" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "InventoryMovementLine"
    ADD COLUMN "salesReservationLineId" UUID;

ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryMovement_salesOrderId_status_idx"
    ON "InventoryMovement"("salesOrderId", "status");

CREATE INDEX "InventoryMovementLine_salesReservationLineId_idx"
    ON "InventoryMovementLine"("salesReservationLineId");

ALTER TABLE "InventoryMovementLine"
    ADD CONSTRAINT "InventoryMovementLine_salesReservationLineId_fkey"
    FOREIGN KEY ("salesReservationLineId") REFERENCES "InventoryReservationLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_transfer_fee_check"
    CHECK ("transferFee" >= 0);

ALTER TABLE "InventoryMovement"
    ADD CONSTRAINT "InventoryMovement_customer_charge_check"
    CHECK (NOT "chargeCustomer" OR "transferFee" > 0);
