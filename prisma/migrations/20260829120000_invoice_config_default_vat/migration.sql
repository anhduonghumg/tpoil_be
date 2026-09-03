-- Thuế suất mặc định của từng môi trường phát hành.
--
-- Dòng đơn chưa tự chọn dòng thuế thì lấy cái này; không có thì hóa đơn đi ra là "không
-- chịu thuế" (KCT) — đúng về kỹ thuật nhưng sai nghiệp vụ với hàng chịu VAT.
ALTER TABLE "InvoiceProviderConfig" ADD COLUMN "defaultVatRateId" UUID;

ALTER TABLE "InvoiceProviderConfig"
    ADD CONSTRAINT "InvoiceProviderConfig_defaultVatRateId_fkey"
    FOREIGN KEY ("defaultVatRateId") REFERENCES "VatRate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
