Hãy review toàn bộ Prisma database schema ERP hiện tại, tập trung sâu vào phân hệ mua hàng, kho, vận hành, đối chiếu kho và khả năng mở rộng sang bán hàng.

Không cần ưu tiên giữ nguyên thiết kế hiện tại. Nếu kiến trúc đang sai, trùng lặp, khó đảm bảo toàn vẹn dữ liệu hoặc không phù hợp để mở rộng, có thể đề xuất đập bỏ và thiết kế lại. Mục tiêu là tạo ra kiến trúc database tốt, rõ ràng, kiểm soát được dữ liệu và vận hành lâu dài; không phải cố tận dụng schema cũ bằng mọi giá.

## 1. Nghiệp vụ kho đã chốt

Không quản lý chi tiết từng bồn vật lý. Đơn vị quản lý chính là:

* Kho
* Mặt hàng
* Chủ sở hữu hàng: công ty hoặc từng khách hàng
* Cơ sở số lượng: lượng thực tế và V15 khi cần

Một kho vật lý duy nhất được sử dụng chung cho vận hành, kinh doanh và kế toán. Không tạo riêng “kho kinh doanh” và “kho kế toán”.

Có thể tồn tại các góc nhìn khác nhau trên cùng một kho:

* Tồn vật lý
* Tồn khả dụng để xuất/bán
* Tồn đang chờ chứng từ
* Tồn đã được hạch toán kế toán

## 2. Ba nhóm hàng cấp cao

### Hàng tồn kho tại thời điểm

Là hàng đã thực nhập và đang nằm tại kho. Đây là nhóm duy nhất được xét để xuất.

Bên trong gồm:

* Có thể xuất/bán
* Đã giữ cho khách hàng hoặc đơn hàng
* Chưa được bán/xuất do chưa đủ điều kiện
* Không được xuất tiếp

Công thức bắt buộc:

Tồn kho tại thời điểm
= Có thể xuất/bán

* Đã giữ cho khách/đơn hàng
* Chưa được bán/xuất
* Không được xuất tiếp

Đối với hàng thuộc khách hàng, đổi cách gọi:

* Có thể xuất/bán → Có thể xuất/rút
* Đã giữ cho khách/đơn → Đã giữ lịch xuất/lệnh xuất
* Chưa được bán → Chưa được xuất

### Hàng đang luân chuyển hoặc tạm xuất

Là hàng đã rời kho nguồn nhưng chưa hoàn tất nghiệp vụ tại điểm nhận, ví dụ:

* Điều chuyển kho
* Tạm xuất giám định
* Tạm xuất xử lý
* Đang giao hàng
* Chờ xác nhận nhập kho đích

Hàng này:

* Không còn nằm trong tồn kho nguồn
* Chưa được tính vào tồn kho đích
* Không được cấp tiếp cho nghiệp vụ khác

### Hàng dự kiến về

Là hàng chưa thực nhập kho, hình thành từ:

* Purchase Order
* Purchase TERM
* Ship Charter Order
* Lịch giao hàng
* Điều chuyển dự kiến
* Nguồn dự kiến thủ công

Hàng dự kiến:

* Không được tính vào tồn kho tại thời điểm
* Không được xuất
* Không được dùng để duyệt đơn bán ở giai đoạn hiện tại

## 3. Trạng thái khả dụng phải có dữ liệu chi tiết

Không chỉ lưu các số tổng hợp như:

* availableQty
* reservedQty
* pendingReleaseQty
* blockedQty
* inTransitQty
* expectedQty

Phải có các bảng nghiệp vụ chi tiết để truy được:

* Số lượng
* Chủ sở hữu
* Kho
* Mặt hàng
* Lý do
* Chứng từ nguồn
* Thời điểm bắt đầu
* Trạng thái
* Người thực hiện
* Số lượng đã giải phóng hoặc đã sử dụng

Cần phân biệt rõ:

* Reservation: hàng đã giữ cho khách hoặc đơn hàng
* Pending release: hàng đang nằm tại kho nhưng chưa đủ điều kiện xuất
* Blocked: hàng không được xuất tiếp
* In transit: hàng đã rời kho
* Expected: hàng chưa nhập kho

Không được dùng một bảng hoặc một field chung để biểu diễn tất cả các khái niệm này.

## 4. Tồn theo chủ sở hữu

Hệ thống phải biết chính xác:

* Công ty còn bao nhiêu hàng tại từng kho, từng mặt hàng
* Mỗi khách hàng còn bao nhiêu hàng tại từng kho, từng mặt hàng
* Hàng của khách hàng không được tính vào tồn bán tự do của công ty
* Việc chuyển quyền sở hữu có thể không làm thay đổi tồn vật lý tại kho

Ví dụ công ty bán hàng cho khách nhưng khách tiếp tục gửi hàng tại kho:

* Tồn vật lý không đổi
* Tồn sở hữu của công ty giảm
* Tồn sở hữu của khách tăng

Hãy đánh giá xem cần tách:

* Physical inventory
* Ownership inventory
* Availability control

hay có mô hình tốt hơn.

## 5. Đối chiếu kho bằng file NCC

Kho hoặc nhà cung cấp thường gửi file Excel để đối chiếu.

Luồng nghiệp vụ:

1. Tạo phiên đối chiếu theo kho và ngày chốt
2. Upload file gốc
3. Lưu file, checksum và metadata
4. Đọc dữ liệu thô từng dòng
5. Preview
6. Mapping mặt hàng, khách hàng/chủ sở hữu và cột dữ liệu
7. Chuẩn hóa dữ liệu
8. Snapshot số ERP tại đúng thời điểm đối chiếu
9. So sánh dữ liệu NCC với ERP
10. Sinh chênh lệch
11. Giải trình nguyên nhân
12. Xử lý bằng chứng từ phù hợp
13. Đóng phiên đối chiếu

File đối chiếu không được tự sửa balance hoặc ledger.

Nếu có chênh lệch chưa xác định được nguyên nhân, hệ thống có thể tạo restriction:

* Không được xuất tiếp
* Lý do: khóa đối chiếu kho

Cần hỗ trợ:

* File chỉ có tổng theo mặt hàng
* File có chi tiết theo từng chủ sở hữu
* File có định dạng khác nhau theo từng NCC
* Mapping tên/mã mặt hàng
* Mapping tên/mã khách hàng
* Nhiều phiên bản file thay thế
* Giữ lịch sử file cũ để audit
* Import idempotent bằng checksum

## 6. Dashboard kho dự kiến

Màn kho có hình bồn đại diện cho một kho và mặt hàng. Đây là hình trực quan, không phải bồn vật lý.

Bên trong bồn:

* Xanh: có thể xuất/bán
* Vàng: đã giữ cho khách/đơn hàng và chưa được bán/xuất
* Đỏ: không được xuất tiếp

Bên ngoài bồn:

* Hàng đang luân chuyển/tạm xuất
* Hàng dự kiến về
* Chênh lệch đối chiếu nếu có

Dashboard phải hỗ trợ xem theo:

* Thời điểm
* Kho
* Mặt hàng
* Chủ sở hữu
* Công ty hoặc khách hàng
* Actual hoặc V15

## 7. Yêu cầu lịch sử và toàn vẹn dữ liệu

Thiết kế phải bảo đảm:

* Ledger append-only
* Balance chỉ là projection/cache
* Có thể dựng lại balance từ ledger
* Có thể xem tồn tại một thời điểm trong quá khứ
* Không cộng hoặc trừ tồn hai lần
* Có idempotency cho mọi thao tác post
* Có transaction và row locking phù hợp
* Không sửa trực tiếp balance từ API thông thường
* Chứng từ đã post không được hard delete
* Chỉ được VOID, CANCEL hoặc tạo chứng từ đảo
* Có audit log cho thay đổi quan trọng
* Không cho phép tồn âm ngoài trường hợp có chính sách được phê duyệt rõ ràng
* Có constraint để tổng trạng thái khả dụng không vượt tồn thực tế
* Có cơ chế phát hiện và xử lý dữ liệu balance lệch ledger

## 8. Mở rộng trong tương lai

Các phần sau chưa cần triển khai đầy đủ ở lõi hiện tại, nhưng schema phải có khả năng mở rộng:

* Sales Order
* Sales Delivery
* Hạn mức bán theo khoảng thời gian và mặt hàng
* Truy lô mua sang các đơn bán
* FIFO hoặc phân bổ lô thủ công
* Giá vốn tạm tính và giá vốn chính thức
* Lãi/lỗ theo lô mua
* Lãi/lỗ theo đơn bán
* Một lô mua bán cho nhiều đơn
* Một đơn bán lấy từ nhiều lô

Không được đưa các tính năng mở rộng này vào balance kho một cách không cần thiết. Chỉ chuẩn bị aggregate boundary và khóa tham chiếu phù hợp.

## 9. Phạm vi review toàn database

Không chỉ review các model kho. Hãy kiểm tra toàn bộ schema để phát hiện:

* Aggregate root chưa đúng
* Quan hệ vòng hoặc coupling quá chặt
* Model vừa làm header vừa làm line
* Dữ liệu snapshot và dữ liệu master bị trộn
* Field derived có nguy cơ lệch
* Duplicate source of truth
* Enum không phù hợp nghiệp vụ
* Quan hệ nullable không nhất quán
* Cascade delete nguy hiểm
* Thiếu foreign key
* Thiếu unique constraint
* Thiếu index
* Precision Decimal không thống nhất
* Quy ước phần trăm không thống nhất
* Thiếu versioning
* Thiếu trạng thái immutable/posted
* Thiếu idempotency
* Trùng chức năng giữa các module
* Model generic bằng sourceType/sourceId nhưng không có kiểm soát toàn vẹn
* Các phần Purchase TERM, kho, logistics, thanh toán và kế toán đang bị trộn sai ranh giới

Đặc biệt review:

* Customer và vai trò customer/supplier/internal
* SupplierLocation và mô hình kho
* PurchaseOrder và TERM flow
* GoodsReceipt
* InventoryBalance
* InventoryLedger
* WarehouseAvailabilityBalance
* WarehouseAvailabilityLedger
* ExpectedInventory
* WarehouseReservation
* WarehouseTransfer
* ReconcileSession
* ReconcileLine
* ReconcileVariance
* InventoryAdjustment
* SupplierInvoice
* SupplierSettlement
* PaymentAllocation
* PurchasePricingRun
* PurchasePricingStage
* TermShipment
* TermLogisticsCost
* InventoryCostLayer

## 10. Quyền thiết kế lại

Được phép:

* Đổi tên model
* Xóa model
* Gộp model
* Tách model
* Thay đổi aggregate root
* Thay đổi relation
* Thay đổi enum
* Chuyển field sang bảng chi tiết
* Loại bỏ các field tổng hợp dư thừa
* Thay generic sourceType/sourceId bằng relation chặt hơn
* Thiết kế lại toàn bộ phân hệ kho nếu cần
* Đề xuất bounded context hoặc schema/database module riêng nếu hợp lý

Không được giữ thiết kế cũ chỉ vì đã có code sử dụng. Tuy nhiên, mọi thay đổi phải giải thích rõ lợi ích, trade-off và kế hoạch migration.

## 11. Kết quả cần trả

Trả kết quả theo cấu trúc:

### A. Executive summary

* Đánh giá chất lượng schema hiện tại
* Có nên refactor từng phần hay thiết kế lại
* Các quyết định kiến trúc quan trọng nhất

### B. Domain và aggregate boundary

Xác định rõ aggregate root cho:

* Party/Customer
* Contract
* Purchase
* Purchase TERM
* Warehouse
* Inventory
* Ownership
* Availability
* Movement
* Reconciliation
* Logistics
* Accounting
* Payment
* Pricing
* Costing

### C. Vấn đề P0, P1, P2

Mỗi vấn đề cần có:

* Hiện trạng
* Rủi ro
* Ví dụ lỗi dữ liệu có thể xảy ra
* Giải pháp đề xuất

### D. Source of truth matrix

Lập bảng xác định nguồn dữ liệu chuẩn cho:

* Tồn tại kho
* Tồn của từng chủ sở hữu
* Hàng khả dụng
* Hàng đã giữ
* Hàng chưa được xuất
* Hàng bị chặn
* Hàng đang luân chuyển
* Hàng dự kiến
* Tồn kế toán
* Chênh lệch đối chiếu
* Giá mua
* Giá vốn
* Thanh toán
* Công nợ

### E. Sơ đồ model mục tiêu

Trình bày quan hệ giữa các model bằng sơ đồ text hoặc Mermaid.

### F. Prisma schema mục tiêu

Đề xuất schema cụ thể, không chỉ mô tả khái niệm.

Schema phải gồm:

* Enum
* Model
* Relation
* Unique constraint
* Index
* Delete behavior
* Trường version/idempotency khi cần

### G. Luồng nghiệp vụ

Mô tả transaction cho:

* Nhập kho
* Giữ hàng
* Giải phóng hàng
* Chuyển hàng sang chưa được xuất
* Khóa không cho xuất
* Điều chuyển/tạm xuất
* Xác nhận nhập kho đích
* Tạo hàng dự kiến
* Chuyển dự kiến thành tồn thực tế
* Chuyển quyền sở hữu
* Import file đối chiếu
* Xử lý chênh lệch
* Post điều chỉnh

### H. Migration plan

Chia migration thành các phase:

1. Tạo cấu trúc mới
2. Backfill dữ liệu
3. Chạy song song và đối chiếu
4. Chuyển đọc sang schema mới
5. Chuyển ghi sang schema mới
6. Khóa schema cũ
7. Xóa phần cũ

Nêu rõ:

* Dữ liệu nào có thể map tự động
* Dữ liệu nào cần quy tắc nghiệp vụ
* Dữ liệu nào có nguy cơ mất nghĩa
* Script kiểm tra sau migration
* Phương án rollback

### I. Test plan

Đề xuất test cho:

* Double posting
* Concurrent reservation
* Transfer giữa hai kho
* Chuyển quyền sở hữu không đổi tồn vật lý
* Import file trùng
* File thay thế
* Đối chiếu có chênh lệch
* Điều chỉnh tồn
* Truy vấn tồn quá khứ
* Rebuild balance từ ledger
* Tổng ownership không khớp tồn vật lý
* Hàng khách hàng không bị bán nhầm như hàng công ty

Ưu tiên thiết kế đúng, toàn vẹn dữ liệu và khả năng vận hành lâu dài. Không cần né tránh breaking change.
