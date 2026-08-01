CREATE TABLE "public"."VatRate" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v7(),
    "name" TEXT NOT NULL,
    "rate" DECIMAL(5,2) NOT NULL,
    "isExempt" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "VatRate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "VatRate_name_key" ON "public"."VatRate"("name");
CREATE INDEX "VatRate_isActive_sortOrder_idx" ON "public"."VatRate"("isActive", "sortOrder");

INSERT INTO "public"."VatRate" ("name", "rate", "isExempt", "sortOrder", "updatedAt")
VALUES
    ('0%', 0, false, 10, CURRENT_TIMESTAMP),
    ('5%', 5, false, 20, CURRENT_TIMESTAMP),
    ('8%', 8, false, 30, CURRENT_TIMESTAMP),
    ('10%', 10, false, 40, CURRENT_TIMESTAMP),
    ('Không chịu thuế', 0, true, 50, CURRENT_TIMESTAMP);
