-- Nối dòng đơn bán với bảng thuế, và đóng băng nhãn thuế trên dòng hóa đơn.
--
-- Lý do: SalesOrderLine.taxRate chỉ giữ một con số, nên "không chịu thuế" (KCT) và
-- "thuế suất 0%" đều thành 0 và không phân biệt được lúc gửi hóa đơn điện tử — trong
-- khi đó là hai nghiệp vụ thuế khác nhau. VatRate.isExempt mới nói được điều đó.
ALTER TABLE "SalesOrderLine" ADD COLUMN "vatRateId" UUID;

ALTER TABLE "SalesOrderLine"
    ADD CONSTRAINT "SalesOrderLine_vatRateId_fkey"
    FOREIGN KEY ("vatRateId") REFERENCES "VatRate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "SalesOrderLine_vatRateId_idx" ON "SalesOrderLine"("vatRateId");

-- Hóa đơn đóng băng mọi thứ lúc dựng; nhãn thuế cũng vậy, để sau này sửa bảng thuế
-- không làm đổi hóa đơn đã lập.
ALTER TABLE "SalesInvoiceLine" ADD COLUMN "taxRateName" TEXT;
