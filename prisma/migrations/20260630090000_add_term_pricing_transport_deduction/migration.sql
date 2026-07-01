ALTER TABLE "PurchasePricingStage"
ADD COLUMN IF NOT EXISTS "transportDeductionVnd" DECIMAL(18, 2);
