-- Đưa số tài khoản đơn lẻ trên hồ sơ đối tác vào bảng nhiều tài khoản.
--
-- Party."bankAccountNo" vốn là ô duy nhất trên form thêm/sửa đối tác, trong khi
-- PurchaseTermPaymentRequest đã trỏ vào PartyBankAccount từ lâu mà không có đường nào tạo
-- bản ghi. Backfill để mọi đối tác đang có số tài khoản đều xuất hiện trong ô chọn tài
-- khoản thụ hưởng của đề nghị thanh toán.
--
-- Cột Party."bankAccountNo" được GIỮ LẠI: nhiều báo cáo và bản in vẫn đọc nó. Từ nay nó là
-- bản sao của tài khoản mặc định, do backend tự đồng bộ mỗi khi danh sách thay đổi.

INSERT INTO "public"."PartyBankAccount"
    ("id", "partyId", "bankName", "accountNo", "accountName", "isDefault", "isActive", "createdAt", "updatedAt")
SELECT
    uuid_generate_v7(),
    p."id",
    'Chưa xác định',
    btrim(p."bankAccountNo"),
    p."name",
    TRUE,
    TRUE,
    now(),
    now()
FROM "public"."Party" p
WHERE p."bankAccountNo" IS NOT NULL
  AND btrim(p."bankAccountNo") <> ''
  AND NOT EXISTS (
      SELECT 1
      FROM "public"."PartyBankAccount" b
      WHERE b."partyId" = p."id"
        AND b."accountNo" = btrim(p."bankAccountNo")
  );

-- Đối tác đã có sẵn tài khoản nhưng chưa đánh dấu mặc định: lấy tài khoản đang hoạt động
-- cũ nhất, nếu không đề nghị thanh toán sẽ không có gì để điền sẵn.
UPDATE "public"."PartyBankAccount" b
SET "isDefault" = TRUE
WHERE b."isActive"
  AND NOT EXISTS (
      SELECT 1
      FROM "public"."PartyBankAccount" d
      WHERE d."partyId" = b."partyId" AND d."isDefault"
  )
  AND b."id" = (
      SELECT c."id"
      FROM "public"."PartyBankAccount" c
      WHERE c."partyId" = b."partyId" AND c."isActive"
      ORDER BY c."createdAt" ASC, c."id" ASC
      LIMIT 1
  );
