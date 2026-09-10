-- Hai thông tin văn thư cần để in ra Quyết định điều chỉnh giá, không suy được từ dữ liệu giá:
--   decisionNo   — số quyết định của công ty ("03.09.2026/TP")
--   basisDocNo   — công văn Bộ Công Thương làm căn cứ ("7010/BCT-TTTN") và ngày của nó
ALTER TABLE "PriceBulletin" ADD COLUMN "decisionNo" TEXT;
ALTER TABLE "PriceBulletin" ADD COLUMN "basisDocNo" TEXT;
ALTER TABLE "PriceBulletin" ADD COLUMN "basisDocDate" DATE;
