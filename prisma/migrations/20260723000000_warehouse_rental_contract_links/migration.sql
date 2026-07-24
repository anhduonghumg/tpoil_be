-- Liên kết hợp đồng chung với kho thuê. Không thay đổi hoặc xóa dữ liệu hợp đồng kho cũ.
CREATE TABLE "WarehouseRentalContractLink" (
    "contractId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    CONSTRAINT "WarehouseRentalContractLink_pkey" PRIMARY KEY ("contractId", "warehouseId")
);

CREATE INDEX "WarehouseRentalContractLink_warehouseId_idx"
    ON "WarehouseRentalContractLink"("warehouseId");

ALTER TABLE "WarehouseRentalContractLink"
    ADD CONSTRAINT "WarehouseRentalContractLink_contractId_fkey"
    FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WarehouseRentalContractLink"
    ADD CONSTRAINT "WarehouseRentalContractLink_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ContractType" ("id", "code", "name", "description", "isActive", "sortOrder", "createdAt", "updatedAt")
VALUES (uuid_generate_v7(), 'WAREHOUSE_RENTAL', 'Thuê kho', 'Hợp đồng thuê kho/địa điểm lưu trữ', true, 999, NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
