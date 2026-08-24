-- Lưu nhà cung cấp trực tiếp trên lô để phân bổ tồn bán theo mã NCC và TP/NCC.
ALTER TABLE "InventoryLot"
ADD COLUMN "supplierPartyId" UUID;

-- Dữ liệu lô nhập từ đơn mua có thể truy ngược chính xác về nhà cung cấp.
UPDATE "InventoryLot" AS lot
SET "supplierPartyId" = po."supplierCustomerId"
FROM "GoodsReceiptLine" AS grl
JOIN "PurchaseOrderLine" AS pol ON pol."id" = grl."purchaseOrderLineId"
JOIN "PurchaseOrder" AS po ON po."id" = pol."purchaseOrderId"
WHERE lot."receiptLineId" = grl."id"
  AND lot."supplierPartyId" IS NULL;

ALTER TABLE "InventoryLot"
ADD CONSTRAINT "InventoryLot_supplierPartyId_fkey"
FOREIGN KEY ("supplierPartyId") REFERENCES "Party"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "InventoryLot_supplierPartyId_productId_releaseCode_receivedAt_idx"
ON "InventoryLot"("supplierPartyId", "productId", "releaseCode", "receivedAt");
