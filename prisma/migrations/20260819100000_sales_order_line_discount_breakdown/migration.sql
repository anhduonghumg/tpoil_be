-- Tách CK gốc, CK điều chỉnh và CK cuối cho từng dòng đơn bán.
CREATE TYPE "SalesOrderSupplySource" AS ENUM ('TP', 'NCC');

ALTER TABLE "SalesOrderLine"
  ADD COLUMN "discountBaseAmount" DECIMAL(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "discountAdjustmentAmount" DECIMAL(24, 8) NOT NULL DEFAULT 0,
  ADD COLUMN "supplySource" "SalesOrderSupplySource" NOT NULL DEFAULT 'TP';

-- Dữ liệu lịch sử chỉ có một cột CK: coi đó là CK gốc, CK điều chỉnh bằng 0;
-- CK cuối (discountAmount) được giữ nguyên.
UPDATE "SalesOrderLine"
SET "discountBaseAmount" = "discountAmount";

ALTER TABLE "SalesOrderLine"
  ADD CONSTRAINT "SalesOrderLine_discount_final_check"
  CHECK ("discountAmount" = "discountBaseAmount" + "discountAdjustmentAmount" AND "discountAmount" >= 0);
