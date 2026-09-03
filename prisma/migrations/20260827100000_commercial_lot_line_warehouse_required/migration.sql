-- Kho nhận thực tế là dữ liệu bắt buộc theo từng dòng rút lô.
-- Các dòng tạo trước khi có cột này lấy lại kho từ đầu phiếu.
UPDATE "public"."CommercialLotWithdrawalLine" AS line
SET "destinationWarehouseId" = withdrawal."destinationWarehouseId"
FROM "public"."CommercialLotWithdrawal" AS withdrawal
WHERE line."withdrawalId" = withdrawal."id"
  AND line."destinationWarehouseId" IS NULL;

ALTER TABLE "public"."CommercialLotWithdrawalLine"
ALTER COLUMN "destinationWarehouseId" SET NOT NULL;
