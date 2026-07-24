CREATE TABLE "WarehouseArea" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" "MasterStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "WarehouseArea_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseArea_code_key" ON "WarehouseArea"("code");
CREATE INDEX "WarehouseArea_status_sortOrder_name_idx" ON "WarehouseArea"("status", "sortOrder", "name");

ALTER TABLE "Warehouse" ADD COLUMN "areaId" UUID;
ALTER TABLE "PurchaseOrderLine" ADD COLUMN "plannedReceivingAreaId" UUID;
ALTER TABLE "ExpectedSupply" ADD COLUMN "warehouseAreaId" UUID;
ALTER TABLE "ExpectedSupply" ALTER COLUMN "warehouseId" DROP NOT NULL;

CREATE INDEX "Warehouse_areaId_status_name_idx" ON "Warehouse"("areaId", "status", "name");
CREATE INDEX "PurchaseOrderLine_plannedReceivingAreaId_productId_idx" ON "PurchaseOrderLine"("plannedReceivingAreaId", "productId");
CREATE INDEX "ExpectedSupply_warehouseAreaId_productId_ownerPartyId_status_expectedAt_idx"
ON "ExpectedSupply"("warehouseAreaId", "productId", "ownerPartyId", "status", "expectedAt");

ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_areaId_fkey" FOREIGN KEY ("areaId") REFERENCES "WarehouseArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_plannedReceivingAreaId_fkey" FOREIGN KEY ("plannedReceivingAreaId") REFERENCES "WarehouseArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExpectedSupply" ADD CONSTRAINT "ExpectedSupply_warehouseAreaId_fkey" FOREIGN KEY ("warehouseAreaId") REFERENCES "WarehouseArea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
