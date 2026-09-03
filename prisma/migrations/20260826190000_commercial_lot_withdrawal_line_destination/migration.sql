-- Mỗi dòng rút lô có thể nhận về một kho khác nhau. Giữ kho đích cấp phiếu để tương thích các phiếu đã tạo.
ALTER TABLE "public"."CommercialLotWithdrawalLine"
ADD COLUMN "destinationWarehouseId" UUID;

CREATE INDEX "CommercialLotWithdrawalLine_destinationWarehouseId_idx"
ON "public"."CommercialLotWithdrawalLine"("destinationWarehouseId");

ALTER TABLE "public"."CommercialLotWithdrawalLine"
ADD CONSTRAINT "CommercialLotWithdrawalLine_destinationWarehouseId_fkey"
FOREIGN KEY ("destinationWarehouseId") REFERENCES "public"."Warehouse"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
