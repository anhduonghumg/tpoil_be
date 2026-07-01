ALTER TABLE "PurchasePricingStage"
ADD COLUMN IF NOT EXISTS "fundAdjustmentVndPerLiter" DECIMAL(18, 6),
ADD COLUMN IF NOT EXISTS "fundAdjustmentAmountVnd" DECIMAL(18, 2);
