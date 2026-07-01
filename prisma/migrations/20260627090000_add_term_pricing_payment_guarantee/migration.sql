ALTER TABLE "PurchasePricingStage"
ADD COLUMN IF NOT EXISTS "contractPaymentRate" DECIMAL(18, 6),
ADD COLUMN IF NOT EXISTS "contractPaymentAmountVnd" DECIMAL(18, 2),
ADD COLUMN IF NOT EXISTS "bankGuaranteeRate" DECIMAL(18, 6),
ADD COLUMN IF NOT EXISTS "bankGuaranteeFeeVnd" DECIMAL(18, 2);
