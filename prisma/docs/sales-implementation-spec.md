# ĐẶC TẢ TRIỂN KHAI MODULE BÁN HÀNG NỘI BỘ (SALES IMPLEMENTATION SPEC) — v1.2

> **Changelog v1.2** (theo `sales-implementation-spec-v1.1-review.md` — toàn bộ P0 đã xác minh với code):
> - **P0-1**: đổi thứ tự transaction kho: consume/release reservation TRƯỚC inventory posting; delta truyền vào `post()` phải ÂM (`SALES_ISSUE` không tự đổi dấu).
> - **P0-2**: bỏ partial-unique theo `postedAt`; dùng con trỏ `SalesOrderLine.effectiveDeliveryLineId @unique` + conditional UPDATE (tương thích correction).
> - **P0-3**: `SalesInvoice` dual-target thật (XOR + 2 partial unique ORIGINAL theo order/withdrawal); chốt nghiệp vụ hủy hóa đơn (D8).
> - **P0-4**: `SalesDeliveryLine.actualQty` → nullable (null = kho chưa xác nhận).
> - **P0-5**: correction KHÔNG restore reservation cũ — tạo reservation mới cho delivery revision, giữ lịch sử consumed.
> - Thêm: `issueWarehouseId` (D9, không đổi nghĩa cột cũ), enforce cùng legal entity, xe/lái xe authoritative tại delivery, cancel có điều kiện từ WAREHOUSE_PROCESSING, aggregate recon status, snapshot `contract.updatedAt`+`policyHash` (Contract không có cột version), `ScopeType.site` (chữ thường), model `SalesWorkflowEvent`, work item lifecycle Mô hình B (D6), cost API `*InTx` + adapter TERM + regression test, bộ test bổ sung.

> Bản đặc tả **kỹ thuật triển khai**, cụ thể hóa `sales-internal-workflow.md` trên nền code/schema
> hiện có, đã hợp nhất toàn bộ mục Bắt buộc trong `sales-implementation-spec-review.md`.
> Dev (và AI assistant) khi code PHẢI bám theo tài liệu này.
> Nguyên tắc xuyên suốt: **tái sử dụng hạ tầng đang có, không xây module song song.**
>
> **Changelog v1.1** (so với v1.0):
> - SINGLE = một đơn bán duy nhất nhưng **nhiều sản phẩm, nhiều kho xuất**; mỗi kho một phần việc riêng.
> - `SalesDelivery` được định nghĩa lại = **phần việc xuất tại MỘT kho** (warehouse issue). KHÔNG thêm bảng `SalesWarehouseIssue`.
> - Quy tắc xuất một lần chuyển từ cấp đơn xuống **cấp dòng**: mỗi dòng SINGLE chỉ hoàn tất thực xuất một lần.
> - Hóa đơn gốc: **SINGLE = 1 đơn / 1 hóa đơn; LOT = 1 lần rút / 1 hóa đơn** (thay cho 1 lần giao / 1 hóa đơn). Chuỗi ORIGINAL/ADJUSTMENT/REPLACEMENT.
> - Exact-lot allocation dùng chung cho posting tồn + consume giá vốn (cấm FIFO độc lập 2 nơi).
> - Refactor cost layer service nhận `tx` + allocations.
> - Reservation gắn tới order line / withdrawal line.
> - Approval cycle + stale + partial unique + maker-checker.
> - Công thức credit exposure + snapshot chính sách giá khi duyệt.
> - MISA recovery khi worker crash; token cache theo `expires_in`.
> - Permission theo scope kho; dedupe notification theo version/cycle/attempt.
> - `legalEntityId` suy từ kho xuất, không nhận từ request; 1 endpoint dispatch theo `kind`.
> - `SalesLotAdjustment` append-only; đối soát header/line dual-target.
> - Kế hoạch 10 giai đoạn (GĐ 0–9) + bộ test nghiệm thu.
>
> Hai câu trong `sales-internal-workflow.md` được thay thế bởi bản này:
> - Mục 2.1 "Chỉ có một lần xuất kho thành công" → "Mỗi dòng chỉ hoàn tất thực xuất một lần; một đơn có thể có nhiều phần việc kho".
> - Mục 13 "một lần giao tương ứng một hóa đơn" → quy tắc hóa đơn mục 10 dưới đây.

---

## 1. Phạm vi & bốn khái niệm

| Khái niệm | `SalesOrder.kind` | Tạo đơn bán mới? | Xe/lái xe | Xuất kho |
|---|---|---|---|---|
| Mua bán trong ngày (luồng cũ) | `DAY_TRADE` | Có | Theo dòng đơn (giữ nguyên hiện trạng) | Ngoài phạm vi spec này |
| Lấy 1 lần | `SINGLE` | Có | Theo từng phần việc kho (`SalesDelivery`) | Nhiều kho được; **mỗi dòng chỉ xuất thành công 1 lần** |
| Lấy nhiều lần (đơn lô) | `LOT` | Có | KHÔNG cần khi tạo | Không xuất trực tiếp; chỉ qua rút lô |
| Rút lô | — (không phải kind) | **KHÔNG** | Theo lần rút | Mỗi lần rút → 1..N phần việc kho (thường 1) |

**Mô hình SINGLE nhiều kho:**

```text
SO-001 — SINGLE
├─ SalesDelivery (Kho A): E5 10.000 L + DO 8.000 L   → posting A
├─ SalesDelivery (Kho B): E10 5.000 L                → posting B
└─ Đối soát tất cả dòng → MỘT hóa đơn gốc cho SO-001
```

`SalesOrder` là chứng từ thương mại trung tâm; "lần giao chung" của SINGLE chính là đơn,
của rút lô chính là withdrawal request — **không có entity trung gian nào khác**.

### 1.1. Tách luồng DAY_TRADE (GĐ 1, bắt buộc)

- Migrate toàn bộ `SalesOrder` hiện hữu → `kind = DAY_TRADE`.
- Guard `kind === DAY_TRADE` trên: `from-purchase-order`, `attach`, `unlink`, comparison đặt/mua, notification `sales.order.requested`.
- Luồng SINGLE/LOT không được thay đổi hành vi DAY_TRADE.

### 1.2. Quyết định thiết kế đã chốt (mặc định v1, đổi phải sửa spec trước)

| # | Quyết định |
|---|---|
| D1 | `SalesDelivery` = phần việc xuất tại một kho. Không thêm bảng warehouse issue mới. |
| D2 | v1 chỉ bán hàng thuộc sở hữu pháp nhân: `ownerPartyId = warehouse.legalEntity.partyId`. Không tự phân bổ đa owner. Mọi kiểm tra tồn phải theo `warehouse + product + owner` (cấm chỉ check warehouse+product). |
| D3 | Credit exposure tính **sau VAT**, đã trừ chiết khấu. Ưu tiên hạn mức: `Contract.creditLimitOverride` → `Party.tempLimit` (trong `tempFrom..tempTo`) → `Party.creditLimit`. Nợ quá hạn = chặn, cho phép duyệt EXCEPTION. Đơn trả ngay (SAME_DAY) không cần duyệt credit trừ khi khách đang có nợ quá hạn. Tiền trả trước/tiền về chưa phân bổ: trừ vào exposure từ GĐ 7 (trước đó coi = 0). Tiền tệ v1: VND. |
| D4 | `ContractItem.price` = **giá sàn** để kiểm tra; giá bán thực nằm trên `SalesOrderLine.unitPrice`. |
| D5 | Maker-checker BẬT mặc định: người tạo/gửi đơn không được duyệt approval request của chính đơn đó (config tắt được). |
| D6 | `NotificationWorkItem` lifecycle theo **Mô hình B — async có version**: processor tiếp tục tạo/đóng work item sau commit; MỌI event mang `entityVersion/cycle` trong payload; processor bỏ qua event cũ, không reopen work item của version mới hơn. Business service KHÔNG tự upsert work item. |
| D7 | Thực xuất VƯỢT lượng đã giữ ⇒ **CHẶN** (`consumeReservationLine` từ chối). Kho trả lại để Sale sửa lượng đặt (re-check) rồi xác nhận lại. Không tự post phần vượt, không tự kích hoạt thêm reservation (nới bằng config tolerance ở phiên bản sau nếu cần). |
| D8 | Hủy hóa đơn = chuyển `status → CANCELLED` trên chính record (log qua `SalesInvoiceIssuance` action CANCEL), KHÔNG tạo record document type mới. Sau khi hủy được phép phát hành ORIGINAL mới (partial unique loại trừ CANCELLED). Điều chỉnh/thay thế = record mới `ADJUSTMENT/REPLACEMENT` gắn `originalInvoiceId`. |
| D9 | Kho xuất của SINGLE/LOT dùng cột MỚI `SalesOrderLine.issueWarehouseId`; `receivingWarehouseId` giữ NGUYÊN nghĩa cũ cho DAY_TRADE (không dùng 1 cột 2 nghĩa). |

### 1.3. Nguyên tắc bắt buộc (checklist review PR)

1. Rút lô gắn đơn lô đã có, không tạo SalesOrder mới.
2. Đơn lô/lần rút không có hạn → reservation KHÔNG set `expiresAt`.
3. Không có bộ phận điều độ xe. Sale nhập BKS/lái xe, kho kiểm tra lại.
4. Nhiều đơn lô phù hợp → Sale bắt buộc chọn, không trừ ngầm.
5. Duyệt đơn không giảm tồn vật lý. Giữ hàng chỉ giảm khả dụng. Tồn vật lý chỉ giảm khi kho xác nhận (post `SALES_ISSUE`).
6. **Mỗi dòng SINGLE chỉ hoàn tất thực xuất một lần.** Thực xuất thiếu so với đặt ⇒ hoặc kho trả lại sửa trước khi post, hoặc Sale đóng thiếu bằng điều chỉnh có duyệt; KHÔNG tự để phần thiếu thành chuyến thứ hai.
7. Chỉ số thực xuất (kho xác nhận POSTED) mới tính là "đã rút".
8. Không sửa trực tiếp tồn/giá vốn đã ghi nhận — chỉ correction theo mục 9.
9. Hóa đơn: 1 hóa đơn gốc / SINGLE order; 1 hóa đơn gốc / LOT withdrawal; chống trùng DB + idempotency + recovery.
10. Cùng một bộ lot allocation cho: posting tồn, consume reservation, consume giá vốn, truy vết, báo cáo. Cấm 2 service tự chọn lô độc lập.
11. Mọi chuyển trạng thái: append-only event (trước/sau, actor, thời điểm, lý do, version/cycle) ghi trong cùng transaction.
12. Regex chạy trước, DeepSeek chỉ fallback; AI không tự quyết khách/sản phẩm/kho/lô nguồn.
13. Trạng thái `SalesOrder` là trạng thái **tổng hợp** tính lại từ child records trong cùng transaction; kho không set trực tiếp trạng thái cuối của đơn.

---

## 2. Hạ tầng TÁI SỬ DỤNG (cấm xây trùng)

| Nhu cầu | Dùng sẵn | Ghi chú |
|---|---|---|
| Giữ hàng / khả dụng | `InventoryReservation(+Line/Event)`, `InventoryAvailabilityBalance` (`inventory-core.service.ts`) | thêm cột link (mục 3.3) |
| Trừ tồn vật lý | `InventoryCoreService.post(kind=SALES_ISSUE, source.salesDeliveryId)` | mỗi delivery (per-kho) 1 posting — unique có sẵn dùng được nguyên trạng |
| Đảo bút toán | `InventoryCoreService.reverse` | correction mục 9 |
| Giá vốn & phân bổ nguồn | `InventoryCostLayer` + `CostLayerEntry(SALES_ISSUE, salesDeliveryLineId)` | refactor consume nhận `tx`+allocations (mục 8.3) |
| Thông báo | Outbox + resolver + template + `NotificationWorkItem` | resolver mở rộng lọc scope kho |
| Số chứng từ | `DocumentSequence` | thêm `SALES_DELIVERY`, `SALES_WITHDRAWAL`, `SALES_INVOICE` |
| Hạn mức/hồ sơ khách | `Party.creditLimit/tempLimit/...`, `RiskFlag`, `CreditLimitHistory` | |
| Hợp đồng bán & giá sàn | `Contract(kind=SALES)` + `ContractItem` (pattern `ContractCheckService`) | D4 |
| Xe / lái xe | `Vehicle`, `Driver` | |
| Alias parser | `ProductAlias.normalizedName` | |
| Đối trừ ngân hàng | `BankTransaction (counterpartyType=CUSTOMER)`, mirror `Payable*` | |
| Job nền | BullMQ / `background-jobs` | MISA, parser AI |
| Audit | `AuditService` + event tables | audit nghiệp vụ ghi trong transaction, không chỉ dựa HTTP interceptor |
| Mẫu đơn lô | `CommercialLotPosition/Withdrawal` (bên MUA — chỉ mượn pattern; bên bán KHÔNG đòi thanh toán đủ trước khi rút) | |

---

## 3. Thay đổi schema

### 3.1. `SalesOrder` (sửa)

```prisma
kind             SalesOrderKind  @default(DAY_TRADE)   // DAY_TRADE | SINGLE | LOT
legalEntityId    // ĐÃ có — KHÔNG phải input của Sale. Suy từ kho xuất của các dòng
                 // (mọi kho phải cùng 1 LE, khác thì báo lỗi); CẤM lấy record đầu tiên.
contractId       String?         @db.Uuid
paymentTermType  PaymentTermType @default(SAME_DAY)
paymentTermDays  Int?
approvalCycle    Int             @default(0)           // tăng mỗi lần gửi duyệt lại sau sửa
createdById / submittedAt / submittedById / approvedAt / approvedById
rejectedReason / cancelledAt / cancelledById
policySnapshot   Json?           // mục 7.3: kết quả check + ngưỡng + contract version tại lúc duyệt
```

**enum `SalesOrderStatus`** thêm: `PENDING_REVIEW, REJECTED, AWAITING_STOCK, WAREHOUSE_PROCESSING, DELIVERED, AWAITING_RECONCILIATION, AWAITING_INVOICE` (giữ toàn bộ giá trị cũ; `PARTIALLY_RESERVED`, `PARTIALLY_DELIVERED` được DÙNG THẬT — mục 4).

### 3.2. `SalesDelivery` = phần việc xuất tại một kho (sửa, không thêm bảng)

```prisma
// header (đã có: deliveryNo, salesOrderId, warehouseId, status, plannedAt, deliveredAt)
withdrawalRequestId String?  @db.Uuid     // lần rút nguồn (LOT); null với SINGLE
revisionOfId       String?   @db.Uuid     // correction: delivery mới thay delivery VOIDED (mục 9)
vehiclePlate / driverName / vehicleId? / driverId?
issueDocNo         String?                // số phiếu xuất kho
sourceFileName / sourceFileUrl            // chứng từ kho upload
confirmedById / confirmedAt
returnedReason / returnedById / returnedAt
```

**enum `SalesDeliveryStatus`** thêm `RETURNED`: `DRAFT → READY → (RETURNED → READY)* → POSTED | VOIDED`.
`revisionOfId` có self-relation + index.

**`SalesOrderLine`** thêm (D9 + P0-2):

```prisma
issueWarehouseId        String?  @db.Uuid   // KHO XUẤT — BẮT BUỘC với dòng SINGLE/LOT trước khi submit;
                                            // receivingWarehouseId giữ nguyên nghĩa cũ (DAY_TRADE)
effectiveDeliveryLineId String?  @unique @db.Uuid  // con trỏ thực-xuất-hiệu-lực (chỉ dòng SINGLE)
```

Enforce khi submit/reserve: mọi `issueWarehouseId` của đơn phải có `warehouse.legalEntityId = SalesOrder.legalEntityId`
(một đơn = một hóa đơn = một pháp nhân; owner suy từ `warehouse.legalEntity.partyId`).

**`SalesDeliveryLine`** (đã có `salesOrderLineId, ownerPartyId`) sửa/thêm:

```prisma
actualQty         Decimal?             // P0-4: NULLABLE — null = kho CHƯA xác nhận; 0 = xác nhận xuất 0
v15Qty            Decimal?
plannedActualQty  Decimal              // lượng dự kiến giao tại kho này
plannedV15Qty     Decimal?
temperatureC      Decimal?  @db.Decimal(8, 3)   // số đo theo dòng, không đặt ở header
vcf               Decimal?  @db.Decimal(14, 8)
postedAt          DateTime?            // lịch sử; GIỮ NGUYÊN trên line cũ sau VOIDED
```

Cost service chỉ đọc `actualQty` khi delivery `POSTED` và assert not-null, dương.

**Phân bổ lô thực xuất (bắt buộc — nguyên tắc 10):**

```prisma
model SalesDeliveryLotAllocation {
  id                  String   @id ...
  salesDeliveryLineId String   @db.Uuid
  inventoryLotId      String   @db.Uuid
  ownerPartyId        String   @db.Uuid
  actualQty           Decimal  @db.Decimal(24, 6)
  v15Qty              Decimal? @db.Decimal(24, 6)
  @@unique([salesDeliveryLineId, inventoryLotId])
}
```

Đây là **nguồn sự thật duy nhất** về lô thực xuất: cùng bản ghi này được dùng cho
`InventoryCoreService.post`, consume reservation, consume cost layer, truy vết nguồn mua, báo cáo lợi nhuận.
Kho confirm: hệ thống đề xuất FIFO theo `StockBalance` (đúng owner theo D2), kho được sửa lô.

**Ràng buộc xuất-một-lần theo dòng SINGLE (nguyên tắc 6, P0-2):**
KHÔNG dùng partial unique theo `postedAt` (partial index không join được sang `SalesDelivery`,
và correction sẽ đụng unique với line lịch sử). Dùng con trỏ `effectiveDeliveryLineId` (3.1 ở trên):

```sql
-- trong transaction post, với advisory lock theo salesOrderLineId:
UPDATE "SalesOrderLine"
SET "effectiveDeliveryLineId" = :deliveryLineId
WHERE id = :salesOrderLineId AND "effectiveDeliveryLineId" IS NULL;
-- affected = 0 ⇒ dòng đã có thực xuất hiệu lực ⇒ CHẶN
```

Correction: reverse xong ⇒ `effectiveDeliveryLineId = NULL` (nếu đang trỏ line cũ) ⇒ revision POSTED ⇒ trỏ line mới.
Line của LOT withdrawal KHÔNG áp con trỏ này (rút nhiều lần là hợp lệ).

### 3.3. Reservation (sửa `InventoryReservation` + `Line`)

```prisma
// InventoryReservation thêm:
withdrawalRequestId String? @db.Uuid   // rút lô; salesOrderId đã có (SINGLE)
// InventoryReservationLine thêm:
salesOrderLineId        String? @db.Uuid
withdrawalRequestLineId String? @db.Uuid
```

Quy tắc: SINGLE → gắn order + order line; rút lô → gắn withdrawal + withdrawal line.
"Đang giữ" của `SalesLotPosition` = Σ `activeActualQty` của reservation line gắn đúng position (qua withdrawal line → salesOrderLineId). Không set `expiresAt`.

### 3.4. Đơn lô & rút lô

```prisma
model SalesLotPosition {                 // 1-1 SalesOrderLine của đơn kind=LOT
  id, salesOrderLineId @unique
  totalQty    Decimal                    // chốt tại thời điểm duyệt đơn lô
  issuedQty   Decimal @default(0)        // CHỈ tăng khi delivery POSTED; giảm khi correction reverse
  adjustedQty Decimal @default(0)        // projection từ SalesLotAdjustment đã duyệt
  version     Int
  // Đang giữ: tính động (mục 3.3). Còn rút được = total − issued − adjusted − đang giữ.
}

model SalesLotAdjustment {               // append-only, điều chỉnh giảm đơn lô
  id, salesLotPositionId, qty Decimal, reason String
  status SalesApprovalStatus             // PENDING/APPROVED/REJECTED/CANCELLED
  requestedById, decidedById?, decidedAt?, decisionNote?, createdAt
}

model SalesLotWithdrawalRequest {
  id, requestNo @unique                  // DocumentSequence SALES_WITHDRAWAL
  salesOrderId String?                   // đơn lô nguồn — nullable khi NEED_SOURCE,
                                         // BẮT BUỘC trước khi PENDING_REVIEW
  customerPartyId String
  status SalesWithdrawalStatus           // mục 4.3
  vehiclePlate, driverName, vehicleId?, driverId?   // CHỈ là default để prefill xuống delivery;
                                                    // dữ liệu authoritative là trên SalesDelivery (8.3 review)
  approvalCycle Int @default(0)
  note, createdById, submittedAt/By, approvedAt/By, rejectedReason, cancelledAt/By, version, timestamps
}

model SalesLotWithdrawalRequestLine {
  id, requestId, lineNo
  salesOrderLineId String?               // dòng đơn lô nguồn (sau khi chọn)
  productId, warehouseId, requestedQty
}
```

### 3.5. Phê duyệt

```prisma
model SalesApprovalRequest {
  id
  salesOrderId String? / withdrawalRequestId String?   // DB CHECK: đúng 1 trong 2
  approvalCycle Int                                    // cycle của target tại lúc tạo
  type   SalesApprovalType     // PRICE | CREDIT | EXCEPTION
  status SalesApprovalStatus   // PENDING | APPROVED | REJECTED | STALE | CANCELLED
  reasonDetail Json?           // dữ liệu vi phạm
  requestedById, decidedById?, decidedAt?
  decisionNote String?         // BẮT BUỘC khi REJECTED
}
-- partial unique (raw SQL): 1 PENDING / (target, approvalCycle, type)
```

Quy tắc: Sale sửa giá/chiết khấu/số lượng/kho/khách/điều khoản ⇒ mọi request cycle cũ → `STALE`, `approvalCycle`++ khi gửi lại. Đơn chỉ `CONFIRMED` khi mọi request của **cycle hiện tại** APPROVED. Maker-checker theo D5. Update quan trọng dùng optimistic lock `version`.

### 3.6. Đối soát (header/line, dual-target)

```prisma
model SalesReconciliation {
  id
  salesOrderId String? @unique / withdrawalRequestId String? @unique   // CHECK đúng 1 trong 2
  status SalesReconciliationStatus      // OPEN | MATCHED | VARIANCE | RESOLVED
  resolvedById?, resolvedAt?, timestamps
  lines SalesReconciliationLine[]
}
model SalesReconciliationLine {
  id, reconciliationId, salesOrderLineId, salesDeliveryId, salesDeliveryLineId, warehouseId
  orderedQty, plannedQty, warehouseConfirmedQty, docQty?, actualQty, v15Qty?
  status SalesReconciliationStatus      // theo dòng
  varianceNote?, resolvedById?, resolvedAt?
  supersededById String?  @db.Uuid      // correction ⇒ line cũ vô hiệu, line mới thay (mục 9)
  superseded    SalesReconciliationLine? @relation("ReconLineSupersede", ...)  // self-relation + @@index([supersededById])
}
```

**Aggregate status của header** (tính lại trong transaction, chỉ trên các line HIỆU LỰC — line đã superseded không tham gia):

```text
Tất cả line MATCHED             → header MATCHED
≥1 line VARIANCE chưa xử lý     → header VARIANCE
Mọi variance đã RESOLVED        → header RESOLVED
```

Chỉ chuyển đơn/withdrawal sang `AWAITING_INVOICE` khi **mọi line hiệu lực** MATCHED hoặc RESOLVED.
Correction tạo line mới trong cùng transaction và set `supersededById` ngay (không để trạng thái lửng).

### 3.7. Hóa đơn

```prisma
model SalesInvoice {
  id, invoiceNoInternal @unique          // DocumentSequence SALES_INVOICE — tạo TRƯỚC khi gọi MISA,
                                         // đồng thời là transaction key phía MISA
  salesOrderId        String? @db.Uuid   // CHỈ SINGLE (P0-3: dual-target XOR)
  withdrawalRequestId String? @db.Uuid   // CHỈ LOT (order nguồn truy ngược qua withdrawal.salesOrderId)
  documentType SalesInvoiceDocumentType @default(ORIGINAL)  // ORIGINAL | ADJUSTMENT | REPLACEMENT
  originalInvoiceId String?              // chuỗi chứng từ, không update đè hóa đơn pháp lý
  status SalesInvoiceStatus              // DRAFT | PENDING_ISSUE | ISSUED | ISSUE_FAILED | CANCELLED
                                         // D8: hủy = status CANCELLED trên chính record (log Issuance CANCEL);
                                         //     sau hủy ĐƯỢC phát hành ORIGINAL mới;
                                         //     điều chỉnh/thay thế = record ADJUSTMENT/REPLACEMENT mới
  buyerName/buyerTaxCode/buyerAddress    // snapshot
  subtotal/discountTotal/taxTotal/grandTotal, currency
  misaTransactionId String? @unique
  misaInvoiceNo/misaTemplateNo/misaSerial, issuedAt?
  createdById, version, timestamps
}
```

Raw SQL migration (P0-3):

```sql
ALTER TABLE "SalesInvoice" ADD CONSTRAINT chk_sales_invoice_target CHECK (
  ("salesOrderId" IS NOT NULL AND "withdrawalRequestId" IS NULL) OR
  ("salesOrderId" IS NULL AND "withdrawalRequestId" IS NOT NULL)
);
CREATE UNIQUE INDEX uq_sales_invoice_original_order ON "SalesInvoice" ("salesOrderId")
  WHERE "documentType" = 'ORIGINAL' AND "status" <> 'CANCELLED' AND "salesOrderId" IS NOT NULL;
CREATE UNIQUE INDEX uq_sales_invoice_original_withdrawal ON "SalesInvoice" ("withdrawalRequestId")
  WHERE "documentType" = 'ORIGINAL' AND "status" <> 'CANCELLED' AND "withdrawalRequestId" IS NOT NULL;
```

```prisma

model SalesInvoiceLine {
  id, salesInvoiceId, lineNo
  salesOrderLineId, salesDeliveryLineId   // truy vết về dòng đơn + dòng thực xuất
  productId, qty, unitPrice, discountAmount, taxRate, amount
}

model SalesInvoiceIssuance {              // log MỌI lời gọi MISA — ghi TRƯỚC và SAU call
  id, salesInvoiceId, attempt Int
  action String                           // PUBLISH | GET_STATUS | CANCEL | ADJUST | REPLACE | SEND_EMAIL
  requestPayload Json (đã che secret); responsePayload Json?
  httpStatus?, errorCode?, status String  // STARTED | SUCCESS | FAILED
  createdAt
}
```

### 3.8. Công nợ phải thu (mirror `Payable*` nguyên mẫu)

`ReceivableOpenItem` (salesInvoiceId @unique, customerPartyId, originalAmount, outstandingAmount, dueDate, status OPEN|PARTIALLY_SETTLED|SETTLED|CANCELLED) + `ReceivableLedgerEntry` (idempotencyKey @unique, type INVOICE|PAYMENT|ADJUSTMENT|REVERSAL) + `ReceivableAllocation` (bankTransactionId, đảo được). Hóa đơn điều chỉnh/thay thế/hủy ⇒ bút toán bù trừ, KHÔNG sửa ledger cũ. OVERDUE là thuộc tính tính từ `dueDate`.

### 3.9. Alias cho parser (GĐ 9, mục 5.3)

```prisma
model PartyAlias {      // alias khách hàng: "APP" → Dầu Mỏ APP
  id, partyId, externalName, normalizedName, validFrom, validTo?
  @@unique([normalizedName, validFrom])
}
model WarehouseAlias {  // alias kho: "HLHP" → Hải Linh HP
  id, warehouseId, externalName, normalizedName, validFrom, validTo?
  @@unique([normalizedName, validFrom])
}
```

(cùng khuôn `ProductAlias` có sẵn; kèm job migrate 1 lần từ Google Sheets đang chứa alias.)

### 3.10. Workflow event (audit nghiệp vụ — ghi TRONG transaction)

```prisma
model SalesWorkflowEvent {
  id         String   @id ...
  entityType String            // SALES_ORDER | WITHDRAWAL | DELIVERY | INVOICE | RECONCILIATION | APPROVAL
  entityId   String   @db.Uuid
  eventType  String            // SUBMIT | APPROVE | REJECT | RECALL | CANCEL | RESERVE | POST | RETURN | VOID | ...
  fromStatus String?; toStatus String?
  actorId    String?  @db.Uuid
  reason     String?
  version    Int?; cycle Int?
  metadata   Json?
  occurredAt DateTime @db.Timestamptz(6)
  @@index([entityType, entityId, occurredAt])
}
```

API ghi event NHẬN `Prisma.TransactionClient` — không dùng `AuditService` HTTP (connection riêng, ngoài transaction) cho audit nghiệp vụ; AuditLog HTTP chỉ là lớp bổ sung.

### 3.11. Enum mới

`SalesOrderKind`, `SalesWithdrawalStatus`, `SalesApprovalType`, `SalesApprovalStatus` (+STALE), `SalesReconciliationStatus`, `SalesInvoiceStatus`, `SalesInvoiceDocumentType`, `ReceivableOpenItemStatus/EntryType/AllocationStatus`.

**KHÔNG tạo bảng** cho lãi/lỗ nguồn mua (đọc `CostLayerEntry`); log paste của parser là tùy chọn về sau.

---

## 4. State machine

### 4.1. SalesOrder SINGLE — trạng thái TỔNG HỢP

```
DRAFT → PENDING_REVIEW → CONFIRMED → [giữ hàng]
  PENDING_REVIEW: thu hồi→DRAFT | 1 request REJECTED→REJECTED (sửa→DRAFT, cycle++)
Giữ hàng theo TỪNG DÒNG (đúng owner D2, đúng kho):
  giữ được một phần dòng      → PARTIALLY_RESERVED
  không giữ được dòng nào     → AWAITING_STOCK
  giữ đủ tất cả dòng          → RESERVED
RESERVED → tạo SalesDelivery cho TỪNG KHO → WAREHOUSE_PROCESSING
  một phần delivery POSTED    → PARTIALLY_DELIVERED
  tất cả delivery POSTED      → DELIVERED → AWAITING_RECONCILIATION
  delivery RETURNED           → đơn giữ WAREHOUSE_PROCESSING; Sale sửa → READY lại;
                                đổi giá/lượng/công nợ ⇒ re-check + cycle mới phần liên quan
Mọi reconciliation line hiệu lực MATCHED/RESOLVED → AWAITING_INVOICE
Hóa đơn ORIGINAL ISSUED       → COMPLETED
CANCELLED: từ DRAFT/PENDING_REVIEW/REJECTED/CONFIRMED/AWAITING_STOCK/PARTIALLY_RESERVED/RESERVED
  (release toàn bộ reservation).
  Từ WAREHOUSE_PROCESSING: CHỈ khi chưa có delivery nào POSTED (vd mọi delivery RETURNED)
  → VOID các delivery → release reservation → CANCELLED (review 8.4).
  Đã có delivery POSTED: phải qua correction, không hủy trực tiếp.
```

Trạng thái đơn luôn được **tính lại từ child records trong cùng transaction** (helper `recomputeOrderStatus(tx, orderId)`), kho không set trực tiếp.

### 4.2. SalesOrder LOT

```
DRAFT → PENDING_REVIEW → CONFIRMED ("Đang hoạt động"; sinh SalesLotPosition)
→ COMPLETED khi mọi position: issued + adjusted ≥ total
→ CANCELLED chỉ khi mọi issuedQty = 0 và không còn withdrawal mở
```

### 4.3. SalesLotWithdrawalRequest

```
DRAFT ─không tìm được lô→ NEED_SOURCE
DRAFT|NEED_SOURCE ─chọn lô + gửi→ PENDING_REVIEW ─duyệt→ APPROVED ─giữ hàng→ RESERVED
PENDING_REVIEW → REJECTED (note bắt buộc) → sửa → DRAFT (cycle++)
RESERVED ─tạo delivery (1..N kho)→ WAREHOUSE_PROCESSING ─tất cả POSTED→ ISSUED
CANCELLED: trước WAREHOUSE_PROCESSING; RESERVED thì release reservation trước.
```

### 4.4. SalesDelivery: `DRAFT → READY → (RETURNED → READY)* → POSTED | VOIDED`; correction: `POSTED → VOIDED` + tạo revision mới (`revisionOfId`) — mục 9.
### 4.5. SalesInvoice: `DRAFT → PENDING_ISSUE → ISSUED | ISSUE_FAILED (→ recovery/retry → PENDING_ISSUE)`; ADJUSTMENT/REPLACEMENT là record mới gắn `originalInvoiceId`.
### 4.6. ReceivableOpenItem: `OPEN → PARTIALLY_SETTLED → SETTLED`; `CANCELLED` qua bút toán bù trừ khi hủy/thay thế hóa đơn.

---

## 5. Nhập nhanh (`SalesQuickEntryService`)

> Kế thừa quy tắc nghiệp vụ đã kiểm chứng thực tế từ Google Apps Script hiện hành
> (`prisma/docs/order-speed.md` — chỉ tham khảo quy tắc, KHÔNG bê kiến trúc).
> ⚠️ File tham khảo chứa API key thật — key phải được thu hồi; production dùng env `DEEPSEEK_API_KEY`.

### 5.1. Pipeline

```
Làm sạch (normalize newline, `=`→`:`, `_–`→`-`, tách label dính dòng, autoFix "Key value" thiếu ":")
→ Regex parse TỪNG DÒNG, không phụ thuộc thứ tự
→ Chuẩn hóa alias qua DB (5.3)
→ isValid? (đủ: khách, loại đơn, BKS+lái xe nếu cần, ≥1 dòng đủ sảnphẩm+qty+kho)
   → đủ ⇒ KHÔNG gọi AI
   → thiếu ⇒ DeepSeek fallback (5.4)
→ Validate kết quả AI với danh mục (alias không khớp ⇒ để TRỐNG, không đoán)
→ Preview + confidence từng trường + ứng viên + cảnh báo (tồn, đơn trùng)
→ Sale sửa + xác nhận ⇒ tạo DRAFT (đơn hoặc yêu cầu rút)
```

### 5.2. Quy tắc parse (kiểm chứng từ vận hành thật — mỗi quy tắc 1 test case)

- **Label linh hoạt**: `Khách hàng|khach hang`, `BKS|BSX|BXS`, `Lx|Lxe|Lái xe|Lai xe`, `Loại đơn`, `Đơn: <số>` (số thứ tự tin nhắn — KHÔNG phải mã đơn lô nguồn).
- **BKS**: cắt đuôi lái xe dính trong BKS (`34C-118.23 - Lx: Cường`), bỏ chấm/space, tách chữ-số: `88c05508` → `88C-05508`; nhận `34C-118.23`, `34c 118.23`.
- **Số lượng kiểu VN** (`parseLocalizedNumber`): `15.050`→15050; `15,050`→15050; **AI làm mất 0 cuối**: `15.05`→15050 (pad 3); `15,5`→15.5; bỏ chữ `lít/lit/L`. Giữ nguyên số, không tự nhân/chia.
- **Loại đơn theo từ khóa** (bỏ dấu, lowercase): bắt đầu `lay moi|mua moi|dat moi` → SINGLE; chứa `rut lo|rut hang|lay lo|rut gui|rut luong|rut ton|giao hang gui` → RÚT LÔ; `lay nhieu lan|don lo|mua lo` → LOT.
- **Dòng chi tiết**: `<sản phẩm> - <qty> - <kho>` hoặc `<sản phẩm>: <qty> - <kho>`; kho ghi 1 lần cho cả đơn ⇒ áp mọi dòng; kho theo dòng ⇒ dùng theo dòng.
- **Ngày đơn**: mặc định hôm nay; sau `SALES_ORDER_DATE_CUTOFF_HOUR` (config, mặc định 15h) ⇒ ĐỀ XUẤT ngày mai trong preview (Sale sửa được).
- **Đơn trùng**: cảnh báo trong preview nếu cùng ngày đã có đơn trùng (khách + BKS + sản phẩm + qty).

### 5.3. Alias qua DB (không hardcode trong code/prompt)

- Sản phẩm: `ProductAlias` (có sẵn) — seed bảng alias thực tế: `D5/DO/DO005/dau05/DO 0,05/DO 0.5S...`→Dầu Diezen 0.05S; `D01/DO001/DO 0.01S...`→0.001S; `E5/xăng E5/E5RON92`→Xăng E5 RON92; `E10/A95/RON95/Mogas 95/xăng`→Xăng E10 RON95-III. **Quy tắc cứng: `D5/dầu/DO005` không bao giờ là Dầu 01; không khớp alias ⇒ để trống, KHÔNG default.**
- Khách & kho: bảng MỚI `PartyAlias`, `WarehouseAlias` (cùng dạng `normalizedName` như ProductAlias — hiện các alias này đang sống trong Google Sheets "DM đối tác"/"Chiết Khấu TB") + API quản lý + job migrate 1 lần từ sheet. `APP`→Dầu Mỏ APP, `HLHP`→Hải Linh HP...
- BKS đối chiếu `Vehicle` (theo khách), lái xe đối chiếu `Driver`; không khớp vẫn cho qua dạng free-text (kho kiểm tra lại).

### 5.4. DeepSeek fallback

- Env: `DEEPSEEK_API_KEY/BASE_URL/MODEL`; `temperature 0`, thinking disabled, JSON schema output; input cắt ≤1500 ký tự.
- Prompt chỉ yêu cầu TÁCH TRƯỜNG (structured extraction); danh mục/alias validate phía server sau khi nhận — AI không tự quyết khách/sản phẩm/kho/lô nguồn/duyệt.
- Cache theo hash nội dung (5 phút), throttle chống double-paste, retry/backoff cho 429/503, lỗi thì trả preview những gì regex parse được kèm cờ "AI không khả dụng".

### 5.5. Ghi chú ngoài phạm vi parser

Chiết khấu tự động theo kho × sản phẩm (sheet "Chiết Khấu TB", rút lô CK=0) thuộc nhóm kiểm tra giá
(mục 7) — sheet này là nguồn tham chiếu khi xây bảng chính sách chiết khấu; parser không tự điền giá/CK.

---

## 6. Tìm lô nguồn khi rút

Tiêu chí: đúng khách + sản phẩm + kho + đơn LOT `CONFIRMED` + còn-rút-được ≥ yêu cầu (tính cả yêu cầu đang treo).
KHÔNG dùng BKS/lái xe/số thứ tự tin nhắn/hạn rút. 1 lô → đề xuất, Sale xác nhận; nhiều lô → bảng chọn bắt buộc (đề xuất lô cũ nhất); 0 lô → `NEED_SOURCE` (cấm tự tạo lô/đổi loại/tạo lệnh/trừ lô khách khác).

---

## 7. Kiểm tra nội bộ & phê duyệt

### 7.1. Bốn nhóm kiểm tra (chạy trong transaction submit)

| Nhóm | Kiểm tra | Vi phạm ⇒ |
|---|---|---|
| Hồ sơ | khách Active, không khóa, RiskFlag chặn, hợp đồng SALES hiệu lực | EXCEPTION / cảnh báo |
| Giá | `unitPrice ≥ ContractItem.price` (giá sàn, D4); chiết khấu ≤ quyền Sale; biên LN dự kiến (doanh thu − giá vốn preview FIFO) ≥ ngưỡng | PRICE |
| Công nợ | công thức 7.2 vượt hạn mức; trả sau theo D3 | CREDIT |
| Tồn | khả dụng theo `warehouse+product+owner` (D2) đủ từng dòng | cảnh báo (chặn tại bước giữ) |

### 7.2. Công thức exposure (D3)

```text
Exposure = Σ ReceivableOpenItem.outstanding (mọi trạng thái OPEN/PARTIALLY_SETTLED)
         + Σ giá trị (sau VAT, trừ CK) các đơn CONFIRMED..AWAITING_INVOICE chưa có hóa đơn ISSUED
         + giá trị (sau VAT, trừ CK) đơn đang xét
         − tiền trả trước / tiền về chưa phân bổ (từ GĐ 7; trước đó = 0)
Hạn mức hiệu lực = Contract.creditLimitOverride ?? (tempLimit nếu trong hiệu lực) ?? creditLimit
Nợ quá hạn tồn tại ⇒ chặn (EXCEPTION mới mở).
```

### 7.3. Snapshot khi CONFIRMED

Ghi vào `SalesOrder.policySnapshot`: đơn giá/CK/thuế từng dòng, điều khoản thanh toán, `contractId` + `contract.updatedAt` + các giá trị hợp đồng đã áp dụng + `policyHash` (Contract KHÔNG có cột `version` — không ghi version không tồn tại; review 8.6), ngưỡng chính sách + kết quả check + `approvalCycle`. Hóa đơn và mọi bước sau **đọc snapshot + số thực xuất**, không đọc lại `ContractItem` động.

---

## 8. Kho xuất & posting

### 8.1. Tạo phần việc kho

Đơn/withdrawal sang RESERVED ⇒ group dòng theo `receivingWarehouseId` (nghĩa từ v1.1: **kho xuất**) ⇒ mỗi kho 1 `SalesDelivery` (READY) + work item `CONFIRM_SALES_DELIVERY` cho user có `sales.delivery.confirm` **đúng scope kho** (mục 12).

### 8.2. Kho confirm — MỘT transaction duy nhất (thứ tự P0-1, BẮT BUỘC đúng)

Input: từng dòng `confirmedActualQty/v15/temp/vcf` + **lot allocations** (đề xuất FIFO, kho sửa được) + `issueDocNo` + file.

> ⚠️ Consume reservation PHẢI đứng TRƯỚC inventory posting: `post()` assert invariant
> `onHand − reserved − pending − blocked ≥ 0` ngay sau khi giảm onHand — post trước sẽ nổ
> `INVENTORY_AVAILABILITY_INVARIANT_VIOLATION` với mọi đơn đã giữ đủ hàng.

```
1. Advisory locks (thứ tự cố định): delivery → salesOrderLineId các dòng → order/withdrawal
   → reservation lines → availability/stock keys → cost layers.
   Validate: delivery READY; allocations khớp tổng qty từng dòng; owner đúng D2;
   cost preview exact-lot (KHÔNG phụ thuộc filter StockBalance > 0 — lô xuất hết về 0 là hợp lệ).
2. Dòng SINGLE: UPDATE effectiveDeliveryLineId ... WHERE ... IS NULL — affected=0 ⇒ CHẶN (P0-2).
3. consumeReservationLine ĐÚNG số thực xuất theo dòng.
   Thực xuất > active reservation ⇒ CHẶN theo D7 (kho trả lại, Sale sửa; không tự post phần vượt).
4. releaseReservationLine phần giữ thừa (giữ nhiều, xuất ít).
5. Ghi SalesDeliveryLotAllocation.
6. InventoryCoreService.post(kind=SALES_ISSUE, source={salesDeliveryId},
     lines = allocations với DELTA ÂM:
       actualQtyDelta: allocation.actualQty.negated(),
       v15QtyDelta:    allocation.v15Qty?.negated())   // post() KHÔNG tự đổi dấu theo kind
   // idempotency sales-delivery:{id}:post
7. CostLayer.commitConsumeInTx(tx, allocations)   // exact-lot theo (lot, owner), KHÔNG FIFO lại (8.3)
8. LOT: SalesLotPosition.issuedQty += thực xuất.
9. Tạo/append SalesReconciliation line từng dòng + recompute aggregate header (3.6).
10. Delivery → POSTED (+ postedAt line); recomputeOrderStatus / withdrawal status.
11. SalesWorkflowEvent + outbox notifications (payload kèm entityVersion/cycle — D6).
Post/cost thất bại ⇒ transaction rollback tự hoàn nguyên consume/release (không cần bù thủ công).
```

### 8.3. Refactor cost layer service (bắt buộc, GĐ 3)

`PurchaseTermCostLayerService` tách lõi transaction-aware:

```ts
previewConsumeInTx(tx, allocations: {salesDeliveryLineId, inventoryLotId, ownerPartyId, qty}[])
commitConsumeInTx(tx, allocations)   // consume ĐÚNG layer của (lot, owner) — không FIFO lại
reverseConsumeInTx(tx, entries)      // đảo append-only qua reversalOfId + idempotencyKey (cho correction)
```

Yêu cầu: KHÔNG đổi FK `CostLayerEntry.salesDeliveryLineId`; API cũ `previewConsume/commitConsume(dto)`
giữ nguyên làm adapter cho luồng TERM (bên trong gọi lõi mới) + **regression test TERM bắt buộc**;
luồng bán cấm dùng bản FIFO tự do; lookup layer theo `(inventoryLotId, ownerPartyId)` unique,
không phụ thuộc điều kiện `StockBalance.actualQty > 0`.

---

## 9. Correction / reverse (sau POSTED)

Không sửa đè. Chuỗi correction đồng bộ trong 1 transaction:

```
VOID delivery cũ:
  reverse InventoryPosting (inventory-core.reverse — onHand tăng lại)
  → reverseConsumeInTx cost entries (bút toán đảo, idempotent)
  → RESERVATION (P0-5): KHÔNG restore reservation cũ — inventory không có event restore và
    không thêm. Reservation cũ GIỮ NGUYÊN lịch sử CONSUMED (append-only).
    Nếu cần giao lại: tạo reservation MỚI cho delivery revision, activate từ số tồn
    vừa được reverse (thứ tự: reverse trước → activate sau, invariant luôn thỏa).
    Hủy correction ⇒ release reservation mới này.
  → dòng SINGLE: effectiveDeliveryLineId = NULL nếu đang trỏ line cũ (postedAt line cũ GIỮ NGUYÊN)
  → LOT: SalesLotPosition.issuedQty −= số đã đảo
  → reconciliation line cũ: supersededById → line mới (cùng transaction)
  → delivery: VOIDED; recompute trạng thái order/withdrawal
Tạo delivery revision mới (revisionOfId) → quy trình 8.2 chạy lại → posting mới, recon line mới,
revision POSTED ⇒ effectiveDeliveryLineId trỏ line mới.
```

- Unique `InventoryPosting.salesDeliveryId` không cản trở: revision là delivery mới.
- **Đã có hóa đơn ISSUED hiệu lực ⇒ CẤM reverse kho độc lập.** Phải đi: hóa đơn điều chỉnh/thay thế/hủy (mục 10, D8) + bút toán receivable bù trừ, rồi mới correction kho.

---

## 10. Hóa đơn MISA

### 10.1. Quy tắc nguồn

```
SINGLE → 1 SalesOrder = 1 hóa đơn gốc (tổng hợp mọi dòng thực xuất của các kho)
LOT    → 1 WithdrawalRequest = 1 hóa đơn gốc
ADJUSTMENT / REPLACEMENT / CANCEL → record mới gắn originalInvoiceId, giữ nguyên lịch sử pháp lý
```

Điều kiện phát hành: mọi delivery bắt buộc POSTED + mọi recon line hiệu lực MATCHED/RESOLVED + snapshot khách/thuế/giá hợp lệ. `SalesInvoiceLine` giữ link `salesOrderLineId` + `salesDeliveryLineId`.

### 10.2. Phát hành & recovery (chống trùng 4 lớp)

1. Partial unique ORIGINAL/target (DB). 2. `misaTransactionId @unique`. 3. Idempotency job. 4. **Recovery**:

```
Tạo invoice DRAFT + invoiceNoInternal (= transaction key MISA) TRƯỚC khi gọi
→ ghi Issuance(STARTED) → gọi MISA → ghi Issuance(SUCCESS/FAILED)
Worker crash giữa chừng ⇒ retry BẮT BUỘC query trạng thái MISA theo transaction key trước:
  đã phát hành ⇒ phục hồi ISSUED trong DB, KHÔNG publish lại
  chưa ⇒ publish tiếp
```

- Job BullMQ: tuần tự theo dải/serial (concurrency 1), delay ≥3s, retry theo mã lỗi MISA cho phép.
- Token: cache theo `expires_in` MISA trả về (không hard-code 14 ngày); refresh khi 401.
- Log che secret. ISSUED ⇒ tạo `ReceivableOpenItem` **idempotent** trong cùng transaction cập nhật trạng thái.

---

## 11. Công nợ, lợi nhuận, báo cáo tồn khách — như v1.0, bổ sung

- Receivables: allocation đảo được; hủy/điều chỉnh hóa đơn ⇒ ledger bù trừ. Nối debt thật vào `CustomerOverviewService`; exposure 7.2 dùng số liệu này.
- **Profitability**: chuỗi truy vết qua `SalesDeliveryLotAllocation`/`CostLayerEntry`; đơn nhiều nguồn phân bổ theo qty từng entry; `costStatus=PROVISIONAL` nếu còn layer tạm tính. **Hồi tố TERM**: thêm entry `REVALUATION(salesDeliveryLineId)` cho phần đã bán, idempotency `pricing:{runId}:issue:{saleEntryId}` (sửa `purchase-term-pricing.service.ts`).
- Báo cáo tồn theo khách 3 tầng (vật lý theo owner / đang giữ / tồn thương mại đơn lô từ `SalesLotPosition`), endpoint `GET /sales/customer-stock`.

---

## 12. Phân quyền theo scope kho

```
permission: sales.delivery.confirm | sales.delivery.return
scopeType : ScopeType.site (enum Prisma hiện là chữ THƯỜNG: global|department|site|employee —
            code dùng ScopeType.site, KHÔNG dùng 'SITE') — theo UserRoleBinding scope hiện có
```

Enforce đồng thời tại: API guard, query hàng đợi kho, service confirm/return (từ chối ngoài scope — không chỉ lọc hiển thị), notification recipient resolver (mở rộng nhận `warehouseId` trong payload và lọc theo binding scope), work item.

Permission list: như v1.0 + không đổi (`sales.submit ... sales.quickentry.use`), seed `04_sales_permissions.seed.ts`.

---

## 13. MA TRẬN THÔNG BÁO (19 events — thiếu 1 dòng không merge)

Danh sách event/người nhận/work item **giữ nguyên v1.0 mục 12** (đơn: review_requested/approved/rejected/recalled/cancelled/stock_insufficient; delivery: ready/returned/posted; withdrawal: review_requested/approved/rejected/cancelled/need_source; đối soát: variance/resolved; hóa đơn: issue_failed/issued/cancelled-adjusted-replaced; receivable.overdue; lot.depleted), với các thay đổi:

- **Dedupe key có chiều phiên bản** (event lặp được không dùng key tĩnh):
  - approval: `{event}:{targetId}:cycle{approvalCycle}`
  - delivery ready/returned/posted: `{event}:{deliveryId}:v{version}`
  - MISA retry: `{event}:{invoiceId}:attempt{n}`
- **Work item lifecycle — Mô hình B (D6)**: processor (sau commit) tiếp tục là nơi DUY NHẤT tạo/đóng
  `NotificationWorkItem`; business service KHÔNG tự upsert. Mọi event mang `entityVersion`/`cycle`
  trong payload; processor so sánh và **bỏ qua event cũ — không reopen work item của version mới hơn**.
  Đóng work item = phát event trạng thái mới (vd approved/cancelled) để processor đóng.
- Emit trong transaction nghiệp vụ; payload luôn có `entityType/entityId` (+`warehouseId` cho event kho).

---

## 14. API (prefix `/sales`)

```
POST   /sales-orders                    // MỘT endpoint, dispatch theo body.kind
                                        // (DAY_TRADE default giai đoạn tương thích; FE mới gửi rõ)
                                        // legalEntityId KHÔNG nhận từ request — suy từ kho xuất
PATCH/DELETE /sales-orders/:id          // DRAFT/REJECTED | DRAFT
POST   /sales-orders/:id/submit|recall|cancel
GET    /sales-orders/:id/checks
POST   /sales-approvals/:id/approve|reject          // reject: note bắt buộc; maker-checker D5
GET    /sales-approvals?mine=1&status=PENDING

GET    /sales-lot-orders/:id                        // 4 số + lịch sử rút + adjustments
POST   /sales-lot-adjustments  (+ approve/reject)
POST   /sales-withdrawals ; GET /sales-withdrawals/source-candidates
POST   /sales-withdrawals/:id/select-source|submit|cancel

GET    /sales-deliveries?warehouseId&status         // scope kho enforce
GET    /sales-deliveries/:id/fifo-suggestion        // đề xuất lot allocation
POST   /sales-deliveries/:id/confirm                // body: lines + allocations + doc + file
POST   /sales-deliveries/:id/return|resend
POST   /sales-deliveries/:id/void                   // correction → revision (mục 9)

GET/POST /sales-reconciliations/...                 // theo order hoặc withdrawal
POST   /sales-invoices/preview  { salesOrderId | withdrawalRequestId }
POST   /sales-invoices/:id/issue|retry|cancel|adjust|replace
GET    /receivables ; POST /receivables/allocations (+/:id/reverse)
GET    /purchases/:id/profitability ; GET /sales-orders/:id/profitability
GET    /sales/customer-stock
POST   /sales/quick-entry/parse|confirm
```

---

## 15. Kế hoạch triển khai (10 giai đoạn)

| GĐ | Nội dung | Điều kiện hoàn thành |
|---|---|---|
| 0 | Khóa mô hình order/delivery-per-kho/invoice; viết migration constraint (partial uniques, CHECK dual-target); test harness | Spec v1.1 duyệt; constraint chạy trên DB dev |
| 1 | `kind` + tách DAY_TRADE (guard đủ 5 chỗ); actor/version; permissions; approval cycle + checks + notifications đơn | DAY_TRADE không đổi hành vi; SINGLE submit/approve/stale/maker-checker chạy |
| 2 | Reservation theo dòng/kho/owner (cột link mới); SINGLE nhiều kho: tạo delivery per-kho + queue + trạng thái tổng hợp (PARTIALLY_*) | Giữ đúng từng dòng; trạng thái tổng hợp đúng theo bảng 4.1 |
| 3 | Exact-lot allocation + refactor cost consume(tx) + posting + confirm 8.2 + correction/void-revision 9 | Tồn & giá vốn cùng lô; concurrent không âm tồn/không double-consume; reverse hoàn nguyên đủ |
| 4 | Reconciliation header/line + variance flow | Multi-product/multi-kho đối soát đúng dòng; correction supersede đúng |
| 5 | LOT + position + withdrawal + adjustment append-only + báo cáo tồn khách | Còn-rút-được đúng khi nhiều reservation đồng thời; adjustment cần duyệt |
| 6 | SalesInvoice chuỗi ORIGINAL/ADJ/REPL + MISA client + job + **recovery crash** | Crash sau publish không trùng; retry query-first; 1 ORIGINAL/target |
| 7 | Receivables + bank allocation + tiền trả trước vào exposure + debt overview | Ledger/outstanding đúng; allocation đảo được |
| 8 | Profitability + hồi tố TERM | 10 chỉ tiêu đủ; chốt TERM revalue cả phần đã bán |
| 9 | Quick entry | Parser chỉ tạo preview/draft |

Không bật LOT production (GĐ 5) trước khi correction GĐ 3–4 ổn định.

## 16. Bộ test nghiệm thu tối thiểu (bắt buộc pass trước khi qua GĐ kế)

**SINGLE nhiều kho:** nhiều sản phẩm/kho; mỗi kho chỉ thấy phần việc trong scope; 1 kho post → `PARTIALLY_DELIVERED`, tất cả → `DELIVERED`; không dòng nào post 2 lần; đúng 1 hóa đơn gốc/order.
**Inventory/cost:** reservation chỉ giảm khả dụng; posting giảm on-hand đúng owner/lô; cost consume đúng lô thực xuất; 2 request đồng thời không âm tồn/không double-consume; retry cùng idempotency không tạo thêm bản ghi.
**Correction:** reverse hoàn nguyên tồn + giá vốn + `issuedQty`; recon cũ superseded; cấm reverse khi hóa đơn hiệu lực.
**LOT:** nhiều lô ⇒ bắt chọn; 0 lô ⇒ NEED_SOURCE; công thức còn-rút-được đúng với reservation đồng thời; chỉ POSTED tăng `issuedQty`; adjustment cần duyệt.
**Approval/credit:** sửa dữ liệu ⇒ request cũ STALE; không 2 PENDING cùng cycle/type; exposure gồm invoice + đơn chưa invoice − trả trước; tempLimit đúng khoảng hiệu lực; maker-checker chặn tự duyệt.
**MISA/receivable:** crash sau publish không trùng; retry query-first; 1 ORIGINAL/order; adjustment/replacement giữ lịch sử; receivable tạo 1 lần, allocation/reversal đúng outstanding.
**Permission/notification:** user kho A không confirm kho B (cả API lẫn service); notification đúng permission + scope; return lần 2 vẫn ra notification mới theo version; work item đóng khi entity đổi trạng thái.
**Reservation/posting invariant (P0-1):** tồn 10.000 + reserve 10.000 → post 10.000 THÀNH CÔNG (thứ tự consume-trước-post); post failure rollback consume; cost failure rollback posting + reservation; thực xuất vượt reservation bị CHẶN theo D7.
**Effective fulfillment SINGLE (P0-2):** 2 delivery đồng thời không cùng post 1 order line (advisory lock + conditional update); correction clear con trỏ và revision post được; line cũ giữ `postedAt` sau VOIDED.
**Invoice dual-target (P0-3):** 2 withdrawal cùng đơn LOT → 2 ORIGINAL khác nhau OK; 1 withdrawal/1 order SINGLE không có 2 ORIGINAL hiệu lực; không invoice nào có đồng thời 2 target; sau CANCELLED phát hành ORIGINAL mới được (D8).
**Multi-warehouse/legal entity:** nhiều kho cùng pháp nhân OK; kho khác pháp nhân bị chặn trước submit/reserve; mỗi delivery đúng owner của LE kho.
**Correction reservation (P0-5):** reverse tăng lại on-hand; reservation cũ giữ lịch sử consumed; reservation revision activate đúng lượng; hủy correction release reservation revision.
**Work item ordering (D6):** event version cũ xử lý muộn không reopen work item đã đóng ở version mới; RETURNED lần 2 tạo work item mới đúng version.
**Cost adapter TERM:** regression test luồng TERM cũ qua adapter không đổi hành vi.

## 17. Quy ước code

- Mỗi nghiệp vụ đa bảng: 1 transaction + `pg_advisory_xact_lock` (pattern inventory-core) + idempotencyKey.
- Trạng thái tổng hợp qua helper recompute trong transaction; optimistic lock `version` cho update quan trọng.
- Notification + template + event constant cùng PR với nghiệp vụ; dedupe theo mục 13.
- Audit nghiệp vụ (event table) trong transaction; AuditLog HTTP là lớp bổ sung.
- `DocumentSequence`: `SALES_ORDER` (có sẵn), thêm `SALES_DELIVERY`, `SALES_WITHDRAWAL`, `SALES_INVOICE`.
- Lỗi `{ code, message }` tiếng Việt; Decimal dùng `Prisma.Decimal`; không thêm `any` mới nếu tránh được.

## 18. File dự kiến

**Sửa:** `prisma/schema.prisma` (+migration/GĐ, gồm raw SQL partial unique + CHECK), `src/modules/sales/*` hiện có, `notification-events.ts`, `notification-template.service.ts`, `notification-recipient-resolver.service.ts` (scope kho), `permissions.constant.ts` + seed mới, `purchase-term-cost-layer.service.ts` (refactor tx), `purchase-term-pricing.service.ts` (hồi tố), `customer-overview.service.ts`, `app.module.ts`.

**Mới (`src/modules/sales/`):** `sales-order-checks.service.ts`, `sales-approvals.service.ts+controller`, `sales-deliveries.service.ts+controller`, `sales-lot-withdrawals.service.ts+controller`, `sales-lot-adjustments.service.ts`, `sales-reconciliation.service.ts+controller`, `sales-invoices.service.ts+controller+jobs/`, `receivables.service.ts+controller`, `sales-profitability.service.ts`, `sales-quick-entry.service.ts+controller`, DTOs; `src/modules/inventory/sales-issue-posting.service.ts`; `src/infra/misa/misa-client.service.ts`; `src/infra/deepseek/deepseek-client.service.ts`.
