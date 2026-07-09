ALTER TABLE "GoodsReceipt"
ADD COLUMN "billQty" DECIMAL(18, 3),
ADD COLUMN "tankQty" DECIMAL(18, 3),
ADD COLUMN "temporaryWithdrawQty" DECIMAL(18, 3),
ADD COLUMN "billToTankLossQty" DECIMAL(18, 3);
