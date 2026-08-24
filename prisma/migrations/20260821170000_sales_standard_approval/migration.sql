-- Mọi đơn Sale nhập lên đều phải qua quản lý duyệt, kể cả đơn không vi phạm chính sách nào.
-- Ba loại cũ (PRICE/CREDIT/EXCEPTION) đều mang nghĩa "có vi phạm" nên không diễn tả được
-- việc duyệt thường lệ; thêm STANDARD cho đúng ngữ nghĩa.
ALTER TYPE "SalesApprovalType" ADD VALUE IF NOT EXISTS 'STANDARD';
