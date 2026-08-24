-- Bảng thông báo chiết khấu theo kho × mặt hàng (prisma/docs/thongbaogia.md).
--
-- Mỗi bản là ảnh chụp trọn vẹn tại một mốc thời gian, không phải bản ghi phần thay đổi:
-- bản gửi khách liệt kê mọi kho, và tra "chiết khấu lúc 15h ngày 7/8" chỉ cần tìm đúng
-- một bản thay vì ghép nhiều lần sửa lại với nhau.

CREATE TYPE "SalesDiscountBoardStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CANCELLED');

CREATE TABLE "SalesDiscountBoard" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "status" "SalesDiscountBoardStatus" NOT NULL DEFAULT 'DRAFT',
  "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
  "announcerName" TEXT,
  "note" TEXT,
  "publishedAt" TIMESTAMPTZ(6),
  "publishedById" UUID,
  "createdById" UUID,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "SalesDiscountBoard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SalesDiscountBoard_status_effectiveFrom_idx"
  ON "SalesDiscountBoard" ("status", "effectiveFrom");

-- Đã phát hành thì phải có mốc phát hành; còn nháp thì không.
ALTER TABLE "SalesDiscountBoard"
  ADD CONSTRAINT "SalesDiscountBoard_published_check"
  CHECK (
    ("status" = 'PUBLISHED' AND "publishedAt" IS NOT NULL)
    OR ("status" <> 'PUBLISHED' AND "publishedAt" IS NULL)
  );

CREATE TABLE "SalesDiscountBoardLine" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "boardId" UUID NOT NULL,
  "warehouseId" UUID NOT NULL,
  "productId" UUID NOT NULL,
  "discountPerUnit" DECIMAL(18, 4) NOT NULL,
  "note" TEXT,
  CONSTRAINT "SalesDiscountBoardLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesDiscountBoardLine_boardId_warehouseId_productId_key"
  ON "SalesDiscountBoardLine" ("boardId", "warehouseId", "productId");
CREATE INDEX "SalesDiscountBoardLine_warehouseId_productId_idx"
  ON "SalesDiscountBoardLine" ("warehouseId", "productId");

-- Chiết khấu âm là nhập nhầm dấu, không phải nghiệp vụ.
ALTER TABLE "SalesDiscountBoardLine"
  ADD CONSTRAINT "SalesDiscountBoardLine_discount_check" CHECK ("discountPerUnit" >= 0);

ALTER TABLE "SalesDiscountBoardLine"
  ADD CONSTRAINT "SalesDiscountBoardLine_boardId_fkey" FOREIGN KEY ("boardId")
  REFERENCES "SalesDiscountBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesDiscountBoardLine"
  ADD CONSTRAINT "SalesDiscountBoardLine_warehouseId_fkey" FOREIGN KEY ("warehouseId")
  REFERENCES "Warehouse" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SalesDiscountBoardLine"
  ADD CONSTRAINT "SalesDiscountBoardLine_productId_fkey" FOREIGN KEY ("productId")
  REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "SalesDiscountBoardRecipient" (
  "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
  "boardId" UUID NOT NULL,
  "customerPartyId" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "sentAt" TIMESTAMPTZ(6),
  "errorMessage" TEXT,
  CONSTRAINT "SalesDiscountBoardRecipient_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SalesDiscountBoardRecipient_boardId_customerPartyId_key"
  ON "SalesDiscountBoardRecipient" ("boardId", "customerPartyId");
CREATE INDEX "SalesDiscountBoardRecipient_boardId_idx"
  ON "SalesDiscountBoardRecipient" ("boardId");

ALTER TABLE "SalesDiscountBoardRecipient"
  ADD CONSTRAINT "SalesDiscountBoardRecipient_boardId_fkey" FOREIGN KEY ("boardId")
  REFERENCES "SalesDiscountBoard" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SalesDiscountBoardRecipient"
  ADD CONSTRAINT "SalesDiscountBoardRecipient_customerPartyId_fkey" FOREIGN KEY ("customerPartyId")
  REFERENCES "Party" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;
