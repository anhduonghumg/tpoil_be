-- Older sales issues consumed every reservation line but left the parent
-- InventoryReservation at ACTIVE. Close only fully consumed holds so the
-- warehouse reservation screen no longer presents obsolete actions.
UPDATE "InventoryReservation" AS reservation
SET
    "status" = 'CONSUMED',
    "version" = "version" + 1
WHERE reservation."status" IN ('ACTIVE', 'PARTIALLY_RELEASED')
  AND NOT EXISTS (
      SELECT 1
      FROM "InventoryReservationLine" AS line
      WHERE line."reservationId" = reservation."id"
        AND line."activeActualQty" > 0
  )
  AND EXISTS (
      SELECT 1
      FROM "InventoryReservationLine" AS line
      WHERE line."reservationId" = reservation."id"
        AND line."consumedActualQty" > 0
  );
