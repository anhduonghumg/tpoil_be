-- Một đơn mua thương mại dùng một mã phát lệnh rút TP/NCC cho toàn bộ số lượng.
ALTER TABLE "PurchaseOrder"
  ADD COLUMN "releaseCode" "SalesOrderSupplySource";

-- Lưu ảnh chụp mã rút tại nơi hình thành tồn để cộng tồn theo TP/NCC ổn định.
ALTER TABLE "CommercialLotPosition"
  ADD COLUMN "releaseCode" "SalesOrderSupplySource";

ALTER TABLE "InventoryLot"
  ADD COLUMN "releaseCode" "SalesOrderSupplySource";

CREATE INDEX "PurchaseOrder_releaseCode_idx" ON "PurchaseOrder"("releaseCode");
CREATE INDEX "CommercialLotPosition_releaseCode_idx" ON "CommercialLotPosition"("releaseCode");
CREATE INDEX "InventoryLot_releaseCode_idx" ON "InventoryLot"("releaseCode");
