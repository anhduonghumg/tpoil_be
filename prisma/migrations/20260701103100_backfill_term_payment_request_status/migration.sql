UPDATE "PurchaseTermPaymentRequest"
SET "status" = 'IN_BATCH'
WHERE "status" = 'APPROVED';
