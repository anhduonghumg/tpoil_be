# ĐẶC TẢ NGHIỆP VỤ BÁN HÀNG NỘI BỘ ERP TPOIL

## 1. Mục tiêu

Hoàn thiện một vòng bán hàng nội bộ từ khi Sale nhập đơn đến khi:

* Đơn được kiểm tra và phê duyệt.
* Lệnh xuất được chuyển cho kho.
* Kho ghi nhận số lượng thực xuất.
* Đơn được đối soát.
* Hóa đơn được phát hành qua MISA.
* Công nợ và thanh toán được theo dõi.
* Đơn được hoàn thành.

Codex phải đọc cấu trúc code, schema, module kho, công nợ, thông báo và phân quyền hiện tại trước khi triển khai. Tận dụng các thành phần đang có, không tự tạo một kiến trúc song song.

---

# 2. Ba loại đơn

## 2.1. Lấy 1 lần – đơn lẻ

Đây là đơn khách đặt hàng và lấy toàn bộ trong một lần.

Ví dụ:

```text id="zkasms"
14/7
Khách hàng: Chí Linh HD
Loại đơn: lấy mới
Xe: 34C-118.23
Lái xe: Nguyễn Đình Cường
DO 05: 9.593 L - Kho HLHP
E10: 9.069 L - Kho HLHP
```

Quy tắc:

* Tạo một đơn bán mới.
* Có thể gồm nhiều sản phẩm.
* Các sản phẩm được xử lý trong cùng một lần lấy.
* Chỉ có một lần xuất kho thành công.
* Muốn lấy thêm phải tạo đơn mới.
* Xe và lái xe được nhập theo lần lấy này.

## 2.2. Lấy nhiều lần – đơn lô

Đây là đơn khách đặt một tổng số lượng nhưng không lấy hết ngay, mà rút dần trong nhiều lần.

Ví dụ:

```text id="36uq2y"
Khách hàng: Dầu Mỏ APP
Loại đơn: lấy nhiều lần
E10: 100.000 L
Kho: Hải Linh HP
```

Quy tắc:

* Tạo một đơn bán lô mới.
* Đơn lô lưu tổng số lượng khách được lấy.
* Khi tạo đơn lô chưa cần có xe hoặc lái xe cố định.
* Đơn lô không có hạn rút.
* Đơn lô không tự động xuất kho ngay.
* Các lần lấy hàng sau được tạo bằng yêu cầu rút lô.
* Một đơn lô có thể phát sinh nhiều lần rút.

Đơn lô phải theo dõi:

* Tổng số lượng ban đầu.
* Số lượng đã rút thực tế.
* Số lượng đang được giữ cho các yêu cầu rút đã duyệt.
* Số lượng còn có thể rút.
* Lịch sử các lần rút.
* Số lượng đã xuất hóa đơn.
* Công nợ và thanh toán liên quan.

## 2.3. Rút lô

Rút lô là yêu cầu lấy một phần hàng từ đơn lô đã được tạo trước đó.

Ví dụ:

```text id="t4c6q5"
Đơn 3
Khách hàng: Dầu Mỏ APP
Loại đơn: rút lô
BKS: 88C-055.08
Lái xe: Đỗ Văn Hiếu
E10: 12.292 L - Kho Hải Linh HP
```

Quy tắc:

* Không tạo một đơn bán mới độc lập.
* Phải gắn yêu cầu rút với một đơn lô đã có.
* Xe và lái xe thuộc lần rút hiện tại.
* Chỉ số lượng kho đã xác nhận xuất thành công mới được tính là đã rút.
* Số thứ tự như “Đơn 3” chỉ là thứ tự trong tin nhắn, không phải mã đơn lô nguồn.

---

# 3. Nhập nhanh đơn hàng

Sale có thể paste toàn bộ nội dung khách gửi vào một ô nhập nhanh.

Hệ thống phải xử lý theo thứ tự:

```text id="6kz6wb"
Làm sạch nội dung
→ Regex đọc dữ liệu
→ Chuẩn hóa từ viết tắt và alias
→ Đối chiếu danh mục trong hệ thống
→ Nếu Regex không đủ thì gọi DeepSeek
→ Kiểm tra lại kết quả AI
→ Hiển thị bản xem trước
→ Sale xác nhận và tạo đơn nháp
```

Regex phải đọc được nội dung dù:

* Thứ tự các dòng thay đổi.
* Viết hoa, viết thường không thống nhất.
* Sai chính tả nhẹ.
* Có hoặc không có dấu.
* BKS viết liền hoặc có dấu chấm, dấu gạch.
* Tên sản phẩm và kho sử dụng từ viết tắt.

Ví dụ:

```text id="4wglwm"
Rút lô APP
Kho HLHP
12.292 E10
Đỗ Văn Hiếu
xe 88c05508
```

vẫn phải được hiểu giống mẫu đơn rút lô chuẩn.

DeepSeek chỉ là phương án dự phòng. Khi Regex đã đọc đủ và dữ liệu hợp lệ thì không gọi AI.

AI không được tự quyết định:

* Khách hàng nào trong hệ thống.
* Sản phẩm nào.
* Kho nào.
* Đơn lô nguồn nào khi có nhiều lựa chọn.
* Đơn có được duyệt hay không.

Sale phải được xem và sửa kết quả trước khi lưu.

---

# 4. Luồng chung từ khi tạo đơn

```text id="kpz816"
Sale nhập nhanh hoặc nhập form
→ Hệ thống tạo bản nháp
→ Sale kiểm tra thông tin
→ Sale gửi kiểm duyệt
→ Hệ thống chạy các kiểm tra nội bộ
→ Tạo yêu cầu duyệt cho đúng bộ phận
→ Tất cả điều kiện cần thiết được thông qua
→ Giữ hàng
→ Chuyển lệnh trực tiếp cho kho
→ Kho xuất hàng
→ Đối soát
→ Phát hành hóa đơn MISA
→ Ghi nhận công nợ
→ Theo dõi thanh toán
→ Hoàn thành
```

Không có bộ phận điều độ xe.

Sale nhập và xác nhận BKS, lái xe. Kho kiểm tra lại trước khi xuất.

---

# 5. Sale tạo và gửi đơn

Sau khi parser đọc nội dung, Sale kiểm tra:

* Ngày đơn.
* Khách hàng.
* Loại đơn.
* Sản phẩm.
* Số lượng.
* Kho.
* Xe và lái xe nếu là đơn lẻ hoặc rút lô.
* Giá bán.
* Chiết khấu.
* Điều khoản thanh toán.
* Hợp đồng liên quan nếu có.

Sale có thể:

* Lưu nháp.
* Sửa dữ liệu.
* Xóa bản nháp chưa gửi.
* Gửi kiểm duyệt.

Khi đã gửi kiểm duyệt, Sale không được sửa trực tiếp. Muốn sửa phải thu hồi đơn nếu chưa có người xử lý, hoặc thực hiện theo quy trình trả lại/chỉnh sửa.

---

# 6. Kiểm tra nội bộ

Khi Sale gửi kiểm duyệt, hệ thống kiểm tra:

## 6.1. Hồ sơ và hợp đồng

* Khách hàng có đang hoạt động không.
* Hồ sơ bắt buộc có hợp lệ không.
* Hợp đồng bán còn hiệu lực không.
* Khách hàng có bị khóa giao dịch không.

## 6.2. Giá và chiết khấu

* Giá có đúng chính sách không.
* Chiết khấu có nằm trong quyền của Sale không.
* Giá bán có thấp hơn mức cho phép không.
* Biên lợi nhuận dự kiến có đạt yêu cầu không.

## 6.3. Công nợ

* Dư nợ hiện tại.
* Nợ quá hạn.
* Hạn mức công nợ.
* Tiền trả trước.
* Các đơn đã duyệt nhưng chưa lập hóa đơn.
* Giá trị đơn đang xét.

## 6.4. Tồn kho

* Số lượng được xuất.
* Số lượng đã giữ.
* Số lượng chờ xử lý.
* Số lượng bị khóa.
* Kho có đủ số lượng hay không.

Duyệt đơn chưa làm giảm tồn vật lý.

Tồn vật lý chỉ giảm khi kho xác nhận xuất thành công.

---

# 7. Phê duyệt theo bộ phận

Không bắt mọi bộ phận phải duyệt thủ công tất cả đơn. Chỉ tạo yêu cầu duyệt khi chính sách hoặc dữ liệu yêu cầu.

## Quản lý kinh doanh

Duyệt khi:

* Giá vượt chính sách.
* Chiết khấu vượt quyền Sale.
* Biên lợi nhuận thấp.
* Có thay đổi quan trọng sau khi đơn đã được duyệt.

## Kế toán công nợ

Duyệt khi:

* Đơn bán trả sau.
* Khách vượt hạn mức.
* Có nợ quá hạn.
* Cần xem xét kế hoạch thanh toán.
* Cần xác nhận tiền trả trước.

## Người có quyền ngoại lệ

Duyệt khi:

* Hồ sơ bị khóa nhưng có đề nghị xử lý ngoại lệ.
* Bán vượt chính sách kho.
* Trường hợp vượt quyền của các bộ phận thông thường.

Các yêu cầu duyệt độc lập có thể xử lý song song.

Đơn chỉ được thông qua khi:

* Tất cả yêu cầu duyệt bắt buộc đã được duyệt.
* Không có yêu cầu nào bị từ chối.
* Không còn lỗi chặn chưa xử lý.

Người từ chối bắt buộc nhập lý do. Sale nhận thông báo để sửa hoặc hủy đơn.

---

# 8. Xử lý đơn lấy 1 lần

Sau khi đơn lẻ được duyệt:

```text id="jxctdv"
Kiểm tra lại tồn
→ giữ hàng
→ tạo lần giao duy nhất
→ chuyển lệnh cho kho
```

Kho nhận được:

* Khách hàng.
* Sản phẩm.
* Số lượng dự kiến.
* Kho xuất.
* BKS.
* Lái xe.
* Ghi chú liên quan.

Kho kiểm tra và nhập số thực xuất:

* Lít thực tế.
* Lít 15 nếu có.
* Nhiệt độ, VCF nếu có.
* Nguồn/lô hàng thực xuất.
* Số phiếu xuất.
* File chứng từ.
* Thời gian xuất.

Sau khi kho xác nhận:

* Tồn vật lý giảm.
* Số lượng đã giữ được sử dụng hoặc giải phóng.
* Đơn chuyển sang chờ đối soát.
* Không được tạo lần xuất thứ hai cho đơn lẻ đã xuất thành công.

---

# 9. Xử lý đơn lấy nhiều lần

Sau khi đơn lô được duyệt:

* Đơn lô chuyển sang trạng thái hoạt động.
* Không tạo lệnh xuất kho ngay.
* Không yêu cầu BKS hoặc lái xe cố định.
* Hệ thống theo dõi tổng lô, đã rút, đang giữ và còn lại.

Khi khách muốn lấy hàng, Sale tạo một yêu cầu rút lô.

Không được tự động coi đơn lô là đã rút khi đơn lô được duyệt.

---

# 10. Xử lý yêu cầu rút lô

## 10.1. Nhập yêu cầu

Sale paste nội dung khách gửi hoặc nhập form.

Parser xác định:

* Khách hàng.
* Loại yêu cầu là rút lô.
* Sản phẩm.
* Số lượng.
* Kho.
* BKS.
* Lái xe.

Sau đó hệ thống tìm các đơn lô nguồn phù hợp.

## 10.2. Tiêu chí tìm đơn lô nguồn

Tìm theo:

* Đúng khách hàng.
* Đúng sản phẩm.
* Đúng kho hoặc phạm vi kho phù hợp.
* Đơn lô đang hoạt động.
* Đơn lô còn số lượng có thể rút.

Không dùng để xác định lô:

* BKS.
* Lái xe.
* Số thứ tự “Đơn 1”, “Đơn 2”, “Đơn 3”.
* Hạn rút vì đơn lô không có hạn rút.

## 10.3. Khi chỉ có một đơn lô phù hợp

Hệ thống tự đề xuất đơn lô đó.

Sale vẫn nhìn thấy và xác nhận trước khi gửi kiểm duyệt.

## 10.4. Khi có nhiều đơn lô phù hợp

Hệ thống hiển thị danh sách:

* Mã đơn lô.
* Ngày tạo.
* Sản phẩm.
* Kho.
* Tổng số lượng.
* Đã rút thực tế.
* Đang giữ cho các lần rút khác.
* Còn có thể rút.

Sale bắt buộc chọn đơn lô nguồn.

Hệ thống có thể đề xuất đơn tạo trước nhưng không được tự động trừ ngầm khi có nhiều lựa chọn.

## 10.5. Khi không có đơn lô phù hợp

Giữ yêu cầu ở trạng thái cần xử lý.

Không được:

* Tự tạo đơn lô mới.
* Tự chuyển thành đơn lấy một lần.
* Tạo lệnh xuất kho.
* Trừ từ đơn lô của khách khác.

## 10.6. Số lượng còn có thể rút

```text id="2c6jfm"
Còn có thể rút
= Tổng số lượng đơn lô
- Số lượng đã xuất thực tế
- Số lượng đang giữ cho các yêu cầu rút đã duyệt
- Số lượng đã giảm khỏi đơn lô bằng điều chỉnh được duyệt
```

Chỉ số lượng kho đã xác nhận xuất thành công mới được tính là đã rút.

Sau khi yêu cầu rút được duyệt:

```text id="ee7rey"
Giữ hàng
→ tạo lần giao
→ chuyển trực tiếp cho kho
→ kho xuất
→ cập nhật đã rút và còn lại
```

---

# 11. Kho trả lại Sale sửa

Nếu phát hiện sai:

* BKS.
* Lái xe.
* Kho.
* Sản phẩm.
* Số lượng hoặc thông tin không khớp.

Kho không tự sửa dữ liệu của Sale.

Kho chọn `Trả lại chỉnh sửa`, nhập lý do và gửi thông báo cho Sale.

Sale sửa xong chuyển lại cho kho. Nếu thay đổi ảnh hưởng giá, công nợ, số lượng hoặc chính sách, hệ thống phải chạy lại kiểm tra và phê duyệt liên quan.

---

# 12. Đối soát

Sau khi kho xuất, đơn hoặc lần rút chuyển sang chờ đối soát.

Đối soát theo từng lần giao, so sánh:

* Số lượng đặt hoặc yêu cầu rút.
* Số lượng dự kiến xuất.
* Số lượng kho xác nhận.
* Số lượng trên phiếu xuất.
* Lít thực tế.
* Lít 15 nếu có.

Kết quả:

* Khớp.
* Có chênh lệch.
* Đã xử lý chênh lệch.

Khi có chênh lệch:

```text id="z2y4f4"
Sale xác nhận
→ Kho giải trình
→ Kế toán kiểm tra ảnh hưởng giá trị
→ Quản lý duyệt nếu cần
→ thực hiện chứng từ điều chỉnh
```

Không sửa trực tiếp dữ liệu tồn kho đã ghi nhận.

---

# 13. Hóa đơn MISA

Sau khi dữ liệu đủ điều kiện lập hóa đơn, Kế toán hóa đơn kiểm tra:

* Thông tin khách hàng.
* MST và địa chỉ.
* Sản phẩm.
* Số lượng.
* Đơn giá.
* Chiết khấu.
* Thuế suất.
* Thành tiền.
* Lần giao nguồn.

Mặc định:

* Đơn lấy một lần: một lần giao tương ứng một hóa đơn.
* Đơn lô: mỗi lần rút tương ứng một hóa đơn.

Hệ thống phải:

* Chống phát hành hóa đơn trùng.
* Lưu toàn bộ kết quả gửi và nhận từ MISA.
* Theo dõi trạng thái phát hành.
* Cho phép retry khi lỗi.
* Hỗ trợ điều chỉnh, thay thế hoặc hủy theo đúng nghiệp vụ.

---

# 14. Công nợ và thanh toán

Sau khi hóa đơn phát hành thành công:

* Ghi nhận khoản phải thu của khách.
* Cập nhật tổng công nợ.
* Theo dõi chưa thanh toán, thanh toán một phần, đã thanh toán và quá hạn.

Khi tiền về:

```text id="4yzgbf"
Kế toán xác định khách hàng
→ chọn hóa đơn cần đối trừ
→ xác nhận phân bổ
→ giảm công nợ
```

Hoàn thành giao hàng và hoàn thành tài chính là hai trạng thái khác nhau.

Đơn có thể đã giao xong nhưng khách vẫn còn công nợ.

---

# 15. Thông báo

## Sale gửi đơn kiểm duyệt

Thông báo cho:

* Quản lý kinh doanh nếu cần duyệt giá.
* Kế toán công nợ nếu cần duyệt tín dụng.
* Người có quyền ngoại lệ nếu có lỗi chặn.

## Đơn bị từ chối

Thông báo cho Sale, gồm:

* Người từ chối.
* Bộ phận.
* Lý do.
* Nội dung cần sửa.

## Đơn được duyệt

Thông báo cho Sale.

## Không đủ hàng để giữ

Thông báo cho Sale và người phụ trách kho.

## Lệnh sẵn sàng xuất

Thông báo cho người có quyền xử lý tại đúng kho xuất.

## Kho trả lại chỉnh sửa

Thông báo cho Sale và hiển thị lý do.

## Kho đã xuất

Thông báo cho Sale và bộ phận đối soát/hóa đơn.

## Đối soát có chênh lệch

Thông báo cho Sale, Kho, Kế toán và quản lý nếu vượt ngưỡng.

## MISA phát hành lỗi

Thông báo cho Kế toán hóa đơn.

## Hóa đơn thành công

Thông báo cho Sale và Kế toán công nợ.

Mỗi thông báo phải mở đúng đơn, yêu cầu rút, lần giao, đối soát hoặc hóa đơn liên quan.

---

# 16. Trạng thái hiển thị nghiệp vụ

## Đơn bán

* Nháp.
* Chờ kiểm duyệt.
* Đã duyệt.
* Bị từ chối.
* Chờ hàng.
* Đã giữ hàng.
* Chờ kho xử lý.
* Đang xuất kho.
* Đã xuất.
* Chờ đối soát.
* Chờ hóa đơn.
* Hoàn thành.
* Đã hủy.

## Yêu cầu rút lô

* Nháp.
* Cần chọn đơn lô.
* Chờ kiểm duyệt.
* Đã duyệt.
* Đã giữ hàng.
* Chờ kho xử lý.
* Đã xuất.
* Bị từ chối.
* Đã hủy.

Codex phải đối chiếu trạng thái đang có trong hệ thống và đề xuất cách mở rộng phù hợp, không tạo trùng khái niệm.

---

# 17. Nguyên tắc bắt buộc

1. Hệ thống có ba loại: lấy 1 lần, lấy nhiều lần và rút lô.

2. Lấy 1 lần và lấy nhiều lần tạo đơn bán mới.

3. Rút lô không tạo đơn bán mới.

4. Rút lô phải gắn với đơn lô đã có.

5. Đơn lô không có hạn rút.

6. Không có bộ phận điều độ xe.

7. Sale nhập xe và lái xe.

8. Kho kiểm tra xe và lái xe.

9. Regex chạy trước, DeepSeek chỉ là fallback.

10. Parser không phụ thuộc thứ tự dòng.

11. Khi khách có nhiều đơn lô, Sale phải chọn đơn lô nguồn.

12. Không được tự động trừ ngầm khi có nhiều lô phù hợp.

13. Duyệt đơn không làm giảm tồn vật lý.

14. Giữ hàng chỉ làm giảm số lượng khả dụng.

15. Tồn vật lý chỉ giảm khi kho xác nhận xuất.

16. Đơn lấy một lần không được xuất thành công nhiều lần.

17. Chỉ số lượng thực xuất mới được tính là đã rút.

18. Không sửa trực tiếp dữ liệu tồn kho đã ghi nhận.

19. Hóa đơn MISA phải chống phát hành trùng.

20. Mọi thao tác quan trọng phải có lịch sử và người thực hiện.

---

# 18. Yêu cầu đối với Codex

Trước khi triển khai, Codex phải:

1. Đọc toàn bộ module bán hàng hiện tại.

2. Đọc schema và các model liên quan.

3. Kiểm tra module kho, reservation, posting, ledger và tồn khả dụng.

4. Kiểm tra module phân quyền, phê duyệt, thông báo và Audit Log.

5. Kiểm tra phần tích hợp MISA hiện có nếu đã tồn tại.

6. Đối chiếu đặc tả này với code hiện tại.

7. Liệt kê:

   * Thành phần có thể tái sử dụng.
   * Thành phần cần chỉnh sửa.
   * Thành phần còn thiếu.
   * Các điểm xung đột với schema hiện tại.
   * Kế hoạch triển khai theo từng bước.

8. Không tự ý tạo API, model hoặc bảng mới trước khi phân tích cấu trúc hiện tại và trình bày phương án.

9. Không xây module kho, công nợ, thông báo hoặc phê duyệt song song với module đã có.

10. Sau khi phân tích, trình bày lại luồng kỹ thuật dự kiến để xác nhận trước khi sửa code.
