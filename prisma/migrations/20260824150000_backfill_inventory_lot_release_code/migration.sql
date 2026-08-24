-- Trước khi trường mã rút được bổ sung, toàn bộ luồng bán mặc định dùng TP.
-- Chỉ backfill các lô truy được về đơn mua; lô thủ công vẫn để trống để kho phân loại.
UPDATE "InventoryLot" AS lot
SET "releaseCode" = COALESCE(po."releaseCode", 'TP'::"SalesOrderSupplySource")
FROM "GoodsReceiptLine" AS grl
JOIN "PurchaseOrderLine" AS pol ON pol."id" = grl."purchaseOrderLineId"
JOIN "PurchaseOrder" AS po ON po."id" = pol."purchaseOrderId"
WHERE lot."receiptLineId" = grl."id"
  AND lot."releaseCode" IS NULL;
