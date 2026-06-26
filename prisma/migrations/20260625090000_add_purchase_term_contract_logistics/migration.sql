-- Enums
CREATE TYPE "public"."TermTransportMode" AS ENUM ('PIPELINE', 'SEA', 'ROAD');
CREATE TYPE "public"."TermShipmentStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'VOID');
CREATE TYPE "public"."TermLogisticsCostStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'ALLOCATED', 'POSTED', 'VOID');
CREATE TYPE "public"."TermLogisticsCostType" AS ENUM ('FREIGHT', 'INSURANCE', 'INSPECTION', 'PORT_FEE', 'HANDLING', 'PIPELINE_FEE', 'STORAGE', 'OTHER');
CREATE TYPE "public"."TermCostAllocationBasis" AS ENUM ('BY_ACTUAL_QTY', 'BY_V15_QTY', 'BY_VALUE', 'MANUAL');

-- Document sequence
CREATE TABLE "public"."DocumentSequence" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "moduleCode" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "currentNo" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentSequence_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentSequence_moduleCode_period_key" ON "public"."DocumentSequence"("moduleCode", "period");

-- Purchase order contract and transport
ALTER TABLE "public"."PurchaseOrder"
    ADD COLUMN "transportMode" "public"."TermTransportMode",
    ADD COLUMN "contractId" UUID;

CREATE INDEX "PurchaseOrder_contractId_idx" ON "public"."PurchaseOrder"("contractId");

ALTER TABLE "public"."PurchaseOrder"
    ADD CONSTRAINT "PurchaseOrder_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "public"."Contract"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Term shipment
CREATE TABLE "public"."TermShipment" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "transportMode" "public"."TermTransportMode" NOT NULL DEFAULT 'SEA',
    "vesselName" TEXT,
    "voyageNo" TEXT,
    "blNo" TEXT,
    "loadingPort" TEXT,
    "dischargePort" TEXT,
    "etd" TIMESTAMP(3),
    "eta" TIMESTAMP(3),
    "surveyorName" TEXT,
    "note" TEXT,
    "status" "public"."TermShipmentStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermShipment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermShipment_purchaseOrderId_idx" ON "public"."TermShipment"("purchaseOrderId");
CREATE INDEX "TermShipment_transportMode_idx" ON "public"."TermShipment"("transportMode");
CREATE INDEX "TermShipment_status_idx" ON "public"."TermShipment"("status");
CREATE INDEX "TermShipment_eta_idx" ON "public"."TermShipment"("eta");

ALTER TABLE "public"."TermShipment"
    ADD CONSTRAINT "TermShipment_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Term logistics cost
CREATE TABLE "public"."TermLogisticsCost" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "purchaseOrderId" UUID NOT NULL,
    "shipmentId" UUID,
    "vendorCustomerId" UUID,
    "documentNo" TEXT,
    "documentDate" DATE,
    "currency" TEXT NOT NULL DEFAULT 'VND',
    "fxRate" DECIMAL(18,6),
    "totalBeforeVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAfterVat" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "public"."TermLogisticsCostStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermLogisticsCost_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermLogisticsCost_purchaseOrderId_idx" ON "public"."TermLogisticsCost"("purchaseOrderId");
CREATE INDEX "TermLogisticsCost_shipmentId_idx" ON "public"."TermLogisticsCost"("shipmentId");
CREATE INDEX "TermLogisticsCost_vendorCustomerId_idx" ON "public"."TermLogisticsCost"("vendorCustomerId");
CREATE INDEX "TermLogisticsCost_documentDate_idx" ON "public"."TermLogisticsCost"("documentDate");
CREATE INDEX "TermLogisticsCost_status_idx" ON "public"."TermLogisticsCost"("status");

ALTER TABLE "public"."TermLogisticsCost"
    ADD CONSTRAINT "TermLogisticsCost_purchaseOrderId_fkey"
    FOREIGN KEY ("purchaseOrderId") REFERENCES "public"."PurchaseOrder"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."TermLogisticsCost"
    ADD CONSTRAINT "TermLogisticsCost_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "public"."TermShipment"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."TermLogisticsCost"
    ADD CONSTRAINT "TermLogisticsCost_vendorCustomerId_fkey"
    FOREIGN KEY ("vendorCustomerId") REFERENCES "public"."Customer"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "public"."TermLogisticsCostLine" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "logisticsCostId" UUID NOT NULL,
    "costType" "public"."TermLogisticsCostType" NOT NULL,
    "productId" UUID,
    "purchaseOrderLineId" UUID,
    "goodsReceiptId" UUID,
    "allocationBasis" "public"."TermCostAllocationBasis" NOT NULL DEFAULT 'BY_ACTUAL_QTY',
    "amountBeforeVat" DECIMAL(18,2) NOT NULL,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountAfterVat" DECIMAL(18,2) NOT NULL,
    "amountVndBeforeVat" DECIMAL(18,2),
    "isCapitalizedToCost" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TermLogisticsCostLine_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermLogisticsCostLine_logisticsCostId_idx" ON "public"."TermLogisticsCostLine"("logisticsCostId");
CREATE INDEX "TermLogisticsCostLine_costType_idx" ON "public"."TermLogisticsCostLine"("costType");
CREATE INDEX "TermLogisticsCostLine_productId_idx" ON "public"."TermLogisticsCostLine"("productId");
CREATE INDEX "TermLogisticsCostLine_purchaseOrderLineId_idx" ON "public"."TermLogisticsCostLine"("purchaseOrderLineId");
CREATE INDEX "TermLogisticsCostLine_goodsReceiptId_idx" ON "public"."TermLogisticsCostLine"("goodsReceiptId");

ALTER TABLE "public"."TermLogisticsCostLine"
    ADD CONSTRAINT "TermLogisticsCostLine_logisticsCostId_fkey"
    FOREIGN KEY ("logisticsCostId") REFERENCES "public"."TermLogisticsCost"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."TermLogisticsCostLine"
    ADD CONSTRAINT "TermLogisticsCostLine_productId_fkey"
    FOREIGN KEY ("productId") REFERENCES "public"."Product"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."TermLogisticsCostLine"
    ADD CONSTRAINT "TermLogisticsCostLine_purchaseOrderLineId_fkey"
    FOREIGN KEY ("purchaseOrderLineId") REFERENCES "public"."PurchaseOrderLine"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "public"."TermLogisticsCostLine"
    ADD CONSTRAINT "TermLogisticsCostLine_goodsReceiptId_fkey"
    FOREIGN KEY ("goodsReceiptId") REFERENCES "public"."GoodsReceipt"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
