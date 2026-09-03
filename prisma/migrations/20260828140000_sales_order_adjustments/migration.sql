CREATE TABLE "SalesOrderAdjustment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "adjustmentNo" TEXT NOT NULL,
    "salesOrderId" UUID NOT NULL,
    "status" "SalesApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "requiresWarehouseCorrection" BOOLEAN NOT NULL DEFAULT false,
    "requiresInvoiceCorrection" BOOLEAN NOT NULL DEFAULT false,
    "requestedById" UUID,
    "decidedById" UUID,
    "decidedAt" TIMESTAMPTZ(6),
    "decisionNote" TEXT,
    "appliedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "SalesOrderAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SalesOrderAdjustmentLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "adjustmentId" UUID NOT NULL,
    "salesOrderLineId" UUID NOT NULL,
    "previousQty" DECIMAL(24,6) NOT NULL,
    "adjustedQty" DECIMAL(24,6) NOT NULL,
    "previousUnitPrice" DECIMAL(24,8) NOT NULL,
    "adjustedUnitPrice" DECIMAL(24,8) NOT NULL,
    "quantityChanged" BOOLEAN NOT NULL,
    "unitPriceChanged" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesOrderAdjustmentLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SalesOrderAdjustmentLine_positive_qty_check" CHECK ("adjustedQty" > 0),
    CONSTRAINT "SalesOrderAdjustmentLine_nonnegative_price_check" CHECK ("adjustedUnitPrice" >= 0),
    CONSTRAINT "SalesOrderAdjustmentLine_changed_check" CHECK ("quantityChanged" OR "unitPriceChanged")
);

CREATE UNIQUE INDEX "SalesOrderAdjustment_adjustmentNo_key"
    ON "SalesOrderAdjustment"("adjustmentNo");
CREATE INDEX "SalesOrderAdjustment_salesOrderId_status_createdAt_idx"
    ON "SalesOrderAdjustment"("salesOrderId", "status", "createdAt");
CREATE UNIQUE INDEX "SalesOrderAdjustmentLine_adjustmentId_salesOrderLineId_key"
    ON "SalesOrderAdjustmentLine"("adjustmentId", "salesOrderLineId");
CREATE INDEX "SalesOrderAdjustmentLine_salesOrderLineId_idx"
    ON "SalesOrderAdjustmentLine"("salesOrderLineId");

ALTER TABLE "SalesOrderAdjustment"
    ADD CONSTRAINT "SalesOrderAdjustment_salesOrderId_fkey"
    FOREIGN KEY ("salesOrderId") REFERENCES "SalesOrder"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesOrderAdjustmentLine"
    ADD CONSTRAINT "SalesOrderAdjustmentLine_adjustmentId_fkey"
    FOREIGN KEY ("adjustmentId") REFERENCES "SalesOrderAdjustment"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SalesOrderAdjustmentLine"
    ADD CONSTRAINT "SalesOrderAdjustmentLine_salesOrderLineId_fkey"
    FOREIGN KEY ("salesOrderLineId") REFERENCES "SalesOrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
