-- 1) Loại hợp đồng nào cho phép mua bán xăng dầu — là DỮ LIỆU, không phải mã cứng.
--
-- Trước đây danh sách này nằm trong code (mảng mã 'HDMBXD', 'HDDL'), nên thêm một loại
-- hợp đồng mới từ màn quản lý sẽ âm thầm không cho giao dịch: đặt đơn báo "chưa có hợp
-- đồng còn hiệu lực" mà không ai hiểu vì sao. Đưa thành cột để thêm loại là thao tác
-- dữ liệu, không phải việc của lập trình viên.
ALTER TABLE "public"."ContractType"
  ADD COLUMN IF NOT EXISTS "allowsTrading" BOOLEAN NOT NULL DEFAULT false;

-- Bật cho hai loại đang dùng để giao dịch. Thuê kho là hợp đồng dịch vụ nên để tắt.
UPDATE "public"."ContractType" SET "allowsTrading" = true WHERE "code" IN ('HDMBXD', 'HDDL');

-- 2) Phụ lục hợp đồng mang giá trị điều khoản đã điều chỉnh.
--
-- Bảng ContractAppendix đã tồn tại từ trước nhưng chưa có API/UI nào dùng tới. Bổ sung
-- các cột điều khoản và bảng chi tiết giá để phụ lục thật sự điều chỉnh được hợp đồng,
-- thay vì chỉ là một file PDF đính kèm.
ALTER TABLE "public"."ContractAppendix"
  ADD COLUMN IF NOT EXISTS "paymentTermDays"     INTEGER,
  ADD COLUMN IF NOT EXISTS "creditLimitOverride" DECIMAL(24,4),
  ADD COLUMN IF NOT EXISTS "createdAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "updatedAt"           TIMESTAMPTZ(6) NOT NULL DEFAULT now();

-- effectiveDate là ngày, không phải mốc thời gian: so sánh với ngày chứng từ.
ALTER TABLE "public"."ContractAppendix"
  ALTER COLUMN "effectiveDate" TYPE DATE USING "effectiveDate"::date;

CREATE UNIQUE INDEX IF NOT EXISTS "ContractAppendix_contractId_code_key"
  ON "public"."ContractAppendix"("contractId", "code");
CREATE INDEX IF NOT EXISTS "ContractAppendix_contractId_effectiveDate_idx"
  ON "public"."ContractAppendix"("contractId", "effectiveDate");

CREATE TABLE IF NOT EXISTS "public"."ContractAppendixItem" (
  "id"         UUID NOT NULL DEFAULT uuid_generate_v7(),
  "appendixId" UUID NOT NULL,
  "productId"  UUID NOT NULL,
  "uom"        TEXT NOT NULL,
  "price"      DECIMAL(65,30) NOT NULL,
  "minQty"     DECIMAL(65,30),
  "maxQty"     DECIMAL(65,30),
  "discount"   DECIMAL(65,30),
  "taxRate"    DECIMAL(65,30),
  "note"       TEXT,
  CONSTRAINT "ContractAppendixItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContractAppendixItem_appendixId_productId_key"
  ON "public"."ContractAppendixItem"("appendixId", "productId");
CREATE INDEX IF NOT EXISTS "ContractAppendixItem_productId_idx"
  ON "public"."ContractAppendixItem"("productId");

ALTER TABLE "public"."ContractAppendixItem"
  ADD CONSTRAINT "ContractAppendixItem_appendixId_fkey"
  FOREIGN KEY ("appendixId") REFERENCES "public"."ContractAppendix"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
