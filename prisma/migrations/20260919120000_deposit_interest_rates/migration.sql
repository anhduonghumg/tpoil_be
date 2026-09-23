-- Lãi suất tiền gửi tham chiếu (nhập tay theo ngày hiệu lực) cho báo cáo lãi bị mất do công nợ.
CREATE TABLE "DepositInterestRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "effectiveFrom" DATE NOT NULL,
    "annualRate" DECIMAL(7,4) NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "DepositInterestRate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DepositInterestRate_annualRate_check" CHECK ("annualRate" >= 0 AND "annualRate" <= 100)
);

CREATE UNIQUE INDEX "DepositInterestRate_effectiveFrom_key" ON "DepositInterestRate"("effectiveFrom");
