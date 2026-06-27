ALTER TABLE "PurchasePricingStage"
ADD COLUMN "contractPaymentRate" DECIMAL(18, 6),
ADD COLUMN "contractPaymentAmountVnd" DECIMAL(18, 2),
ADD COLUMN "bankGuaranteeRate" DECIMAL(18, 6),
ADD COLUMN "bankGuaranteeFeeVnd" DECIMAL(18, 2);
