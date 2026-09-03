-- Tách cấu hình hóa đơn thành hai môi trường (thử nghiệm / thật) thay cho một dòng duy nhất.
-- Bảng đang rỗng nên đổi thẳng, không cần chuyển dữ liệu.
CREATE TYPE "InvoiceEnvironment" AS ENUM ('TEST', 'PRODUCTION');

DROP INDEX IF EXISTS "InvoiceProviderConfig_singleton_key";

ALTER TABLE "InvoiceProviderConfig"
    DROP COLUMN "singleton",
    ADD COLUMN "environment" "InvoiceEnvironment" NOT NULL,
    ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "InvoiceProviderConfig_environment_key" ON "InvoiceProviderConfig"("environment");
CREATE INDEX "InvoiceProviderConfig_active_idx" ON "InvoiceProviderConfig"("active");
