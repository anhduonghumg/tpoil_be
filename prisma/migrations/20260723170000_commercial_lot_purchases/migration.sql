CREATE TYPE "public"."CommercialLotStockState" AS ENUM (
    'EXPORTABLE',
    'TEMPORARY_EXPORT',
    'NON_EXPORTABLE'
);

CREATE TYPE "public"."CommercialLotWithdrawalStatus" AS ENUM (
    'DRAFT',
    'CONFIRMED',
    'CANCELLED'
);

ALTER TABLE "public"."PurchaseOrder"
    ADD COLUMN "createdById" UUID,
    ADD COLUMN "approvedById" UUID,
    ADD COLUMN "approvedAt" TIMESTAMPTZ(6);

CREATE TABLE "public"."CommercialLotPosition" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderLineId" UUID NOT NULL,
    "supplierCustomerId" UUID NOT NULL,
    "plannedWarehouseId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "invoicedQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "withdrawnQty" DECIMAL(24,6) NOT NULL DEFAULT 0,
    "accountingValue" DECIMAL(24,4) NOT NULL DEFAULT 0,
    "stockState" "public"."CommercialLotStockState" NOT NULL DEFAULT 'EXPORTABLE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CommercialLotPosition_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercialLotPosition_quantity_check"
        CHECK ("invoicedQty" >= 0 AND "withdrawnQty" >= 0 AND "withdrawnQty" <= "invoicedQty")
);

CREATE TABLE "public"."CommercialLotInvoiceAllocation" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "commercialLotPositionId" UUID NOT NULL,
    "supplierInvoiceLineId" UUID NOT NULL,
    "qty" DECIMAL(24,6) NOT NULL,
    "accountingValue" DECIMAL(24,4) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CommercialLotInvoiceAllocation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercialLotInvoiceAllocation_qty_check" CHECK ("qty" > 0)
);

CREATE TABLE "public"."CommercialLotWithdrawal" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "withdrawalNo" TEXT NOT NULL,
    "destinationWarehouseId" UUID NOT NULL,
    "withdrawalDate" TIMESTAMPTZ(6) NOT NULL,
    "status" "public"."CommercialLotWithdrawalStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdById" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "CommercialLotWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."CommercialLotWithdrawalLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "withdrawalId" UUID NOT NULL,
    "lineNo" INTEGER NOT NULL,
    "commercialLotPositionId" UUID NOT NULL,
    "actualQty" DECIMAL(24,6) NOT NULL,
    "v15Qty" DECIMAL(24,6),
    "temperatureC" DECIMAL(8,3),
    "density" DECIMAL(14,8),
    "goodsReceiptId" UUID,
    CONSTRAINT "CommercialLotWithdrawalLine_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CommercialLotWithdrawalLine_qty_check" CHECK ("actualQty" > 0)
);

CREATE UNIQUE INDEX "CommercialLotPosition_purchaseOrderLineId_key"
    ON "public"."CommercialLotPosition"("purchaseOrderLineId");
CREATE INDEX "CommercialLotPosition_supplierCustomerId_productId_idx"
    ON "public"."CommercialLotPosition"("supplierCustomerId", "productId");
CREATE INDEX "CommercialLotPosition_plannedWarehouseId_productId_idx"
    ON "public"."CommercialLotPosition"("plannedWarehouseId", "productId");
CREATE INDEX "CommercialLotPosition_stockState_idx"
    ON "public"."CommercialLotPosition"("stockState");

CREATE UNIQUE INDEX "CommercialLotInvoiceAllocation_supplierInvoiceLineId_key"
    ON "public"."CommercialLotInvoiceAllocation"("supplierInvoiceLineId");
CREATE INDEX "CommercialLotInvoiceAllocation_commercialLotPositionId_idx"
    ON "public"."CommercialLotInvoiceAllocation"("commercialLotPositionId");

CREATE UNIQUE INDEX "CommercialLotWithdrawal_purchaseOrderId_withdrawalNo_key"
    ON "public"."CommercialLotWithdrawal"("purchaseOrderId", "withdrawalNo");
CREATE INDEX "CommercialLotWithdrawal_purchaseOrderId_status_withdrawalDate_idx"
    ON "public"."CommercialLotWithdrawal"("purchaseOrderId", "status", "withdrawalDate");
CREATE INDEX "CommercialLotWithdrawal_destinationWarehouseId_withdrawalDate_idx"
    ON "public"."CommercialLotWithdrawal"("destinationWarehouseId", "withdrawalDate");

CREATE UNIQUE INDEX "CommercialLotWithdrawalLine_goodsReceiptId_key"
    ON "public"."CommercialLotWithdrawalLine"("goodsReceiptId");
CREATE UNIQUE INDEX "CommercialLotWithdrawalLine_withdrawalId_lineNo_key"
    ON "public"."CommercialLotWithdrawalLine"("withdrawalId", "lineNo");
CREATE INDEX "CommercialLotWithdrawalLine_commercialLotPositionId_idx"
    ON "public"."CommercialLotWithdrawalLine"("commercialLotPositionId");

ALTER TABLE "public"."CommercialLotPosition"
    ADD CONSTRAINT "CommercialLotPosition_purchaseOrderLineId_fkey"
    FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotPosition_supplierCustomerId_fkey"
    FOREIGN KEY ("supplierCustomerId") REFERENCES "public"."Party"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotPosition_plannedWarehouseId_fkey"
    FOREIGN KEY ("plannedWarehouseId") REFERENCES "public"."Warehouse"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotPosition_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "public"."Product"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."CommercialLotInvoiceAllocation"
    ADD CONSTRAINT "CommercialLotInvoiceAllocation_commercialLotPositionId_fkey"
    FOREIGN KEY ("commercialLotPositionId") REFERENCES "public"."CommercialLotPosition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotInvoiceAllocation_supplierInvoiceLineId_fkey"
    FOREIGN KEY ("supplierInvoiceLineId") REFERENCES "public"."SupplierInvoiceLine"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."CommercialLotWithdrawal"
    ADD CONSTRAINT "CommercialLotWithdrawal_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotWithdrawal_destinationWarehouseId_fkey"
    FOREIGN KEY ("destinationWarehouseId") REFERENCES "public"."Warehouse"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "public"."CommercialLotWithdrawalLine"
    ADD CONSTRAINT "CommercialLotWithdrawalLine_withdrawalId_fkey"
    FOREIGN KEY ("withdrawalId") REFERENCES "public"."CommercialLotWithdrawal"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotWithdrawalLine_commercialLotPositionId_fkey"
    FOREIGN KEY ("commercialLotPositionId") REFERENCES "public"."CommercialLotPosition"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "CommercialLotWithdrawalLine_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
