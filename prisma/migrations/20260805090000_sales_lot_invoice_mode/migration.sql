-- Đơn đặt hàng lô của kinh doanh có hai mẫu, khác nhau đúng một dòng:
--   "Thời gian xuất hóa đơn: Ngay sau khi xác nhận đơn hàng"  -> ON_CONFIRMATION
--   "Thời gian xuất hóa đơn: Xuất hóa đơn theo tiến độ rút hàng" -> ON_WITHDRAWAL
-- Đây không chỉ là chữ trên bản in: nó quyết định lô ra một hóa đơn hay nhiều hóa đơn.

CREATE TYPE "SalesLotInvoiceMode" AS ENUM ('ON_CONFIRMATION', 'ON_WITHDRAWAL');

ALTER TABLE "SalesOrder" ADD COLUMN "lotInvoiceMode" "SalesLotInvoiceMode";

-- Đơn lô đã có từ trước đều đang chạy theo tiến độ rút (cách duy nhất hệ thống hỗ trợ
-- tới thời điểm này), nên gán đúng cách đó thay vì để trống.
UPDATE "SalesOrder" SET "lotInvoiceMode" = 'ON_WITHDRAWAL' WHERE "kind" = 'LOT';

-- Chỉ đơn lô mới có khái niệm này; đơn lấy 1 lần và mua bán trong ngày phải để trống.
ALTER TABLE "SalesOrder"
  ADD CONSTRAINT "SalesOrder_lotInvoiceMode_check"
  CHECK (
    ("kind" = 'LOT' AND "lotInvoiceMode" IS NOT NULL)
    OR ("kind" <> 'LOT' AND "lotInvoiceMode" IS NULL)
  );
