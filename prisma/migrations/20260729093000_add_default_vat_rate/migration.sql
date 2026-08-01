ALTER TABLE "public"."VatRate"
    ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

UPDATE "public"."VatRate"
SET "isDefault" = true
WHERE "name" = '10%';

CREATE UNIQUE INDEX "VatRate_single_default_key"
    ON "public"."VatRate" (("isDefault"))
    WHERE "isDefault" = true;
