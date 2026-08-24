-- Ba loại thương nhân xăng dầu, thay cho việc tick tay CUSTOMER/SUPPLIER.
--
--   TNPP (thương nhân phân phối) — mua VÀ bán
--   TNDM (thương nhân đầu mối)   — chỉ mua của họ
--   TNDL (thương nhân đại lý)    — chỉ bán cho họ
--
-- Dùng lại bảng PartyRole vì nó đã có validFrom/validTo: một đối tác có thể là TNDL một
-- giai đoạn rồi thành TNPP, và đơn hàng cũ phải được xét theo phân loại TẠI THỜI ĐIỂM đó.
--
-- CUSTOMER/SUPPLIER vẫn giữ (mọi truy vấn hiện tại dựa vào chúng, và đối tác dịch vụ vẫn
-- cần là NCC mà không thuộc loại thương nhân nào) nhưng từ nay do hệ thống tự sinh.

ALTER TYPE "PartyRoleType" ADD VALUE IF NOT EXISTS 'TNPP';
ALTER TYPE "PartyRoleType" ADD VALUE IF NOT EXISTS 'TNDM';
ALTER TYPE "PartyRoleType" ADD VALUE IF NOT EXISTS 'TNDL';
