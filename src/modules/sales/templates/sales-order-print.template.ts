import { SalesOrderPrintData, SalesOrderPrintLine } from './sales-order-print.types'

function money(value: number) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(value || 0))
}

/** Chiết khấu in tới 4 số lẻ như trên đơn giấy (850,0000). */
function discountText(value: number) {
    return new Intl.NumberFormat('vi-VN', {
        minimumFractionDigits: 4,
        maximumFractionDigits: 4,
    }).format(value || 0)
}

function qtyText(value: number) {
    return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value || 0)
}

function dateText(value: Date | string | null | undefined) {
    if (!value) return ''
    const date = new Date(value)
    const dd = String(date.getDate()).padStart(2, '0')
    const mm = String(date.getMonth() + 1).padStart(2, '0')
    return `${dd}-${mm}-${date.getFullYear()}`
}

function escapeHtml(input: string | null | undefined) {
    return String(input ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;')
}

function retailRow(line: SalesOrderPrintLine) {
    return `
      <tr>
        <td class="center">${line.index}</td>
        <td>${escapeHtml(line.productName)}</td>
        <td class="right">${qtyText(line.qty)}</td>
        <td class="right">₫ ${money(line.unitPrice)}</td>
        <td class="right">₫ ${discountText(line.discountPerUnit)}</td>
        <td class="right">₫ ${money(line.lineTotal)}</td>
        <td class="center">${escapeHtml(line.vehiclePlate)}</td>
        <td class="center">${escapeHtml(line.driverName)}</td>
        <td class="center">${escapeHtml(line.warehouseName)}</td>
      </tr>`
}

function lotRow(line: SalesOrderPrintLine) {
    return `
      <tr>
        <td class="center">${line.index}</td>
        <td>${escapeHtml(line.productName)}</td>
        <td class="right">${qtyText(line.qty)}</td>
        <td class="right">₫ ${money(line.unitPrice)}</td>
        <td class="right">₫ ${discountText(line.discountPerUnit)}</td>
        <td class="right">₫ ${money(line.lineTotal)}</td>
        <td class="center">${escapeHtml(line.warehouseName)}</td>
      </tr>`
}

/** Phần khác nhau duy nhất giữa hai mẫu đơn lô. */
function invoiceTimingText(data: SalesOrderPrintData) {
    return data.variant === 'LOT_BY_PROGRESS'
        ? 'Xuất hóa đơn theo tiến độ rút hàng'
        : 'Ngay sau khi xác nhận đơn hàng'
}

function retailBody(data: SalesOrderPrintData) {
    return `
    <p class="clause">1. Công ty chúng tôi có nhu cầu đặt hàng <strong>${escapeHtml(data.sellerName)}</strong>, cụ thể như sau:</p>

    <p class="uom">Đơn vị tính: ${escapeHtml(data.uomText)}</p>

    <table class="grid">
      <thead>
        <tr>
          <th style="width:34px">STT</th>
          <th>Mặt hàng</th>
          <th style="width:72px">Số lượng</th>
          <th style="width:74px">Giá bán</th>
          <th style="width:82px">Chiết khấu</th>
          <th style="width:92px">Thành tiền</th>
          <th style="width:74px">Phương tiện</th>
          <th style="width:74px">Điều khiển</th>
          <th style="width:78px">Kho nhận</th>
        </tr>
      </thead>
      <tbody>
        ${data.lines.map(retailRow).join('')}
        <tr>
          <td colspan="9" class="right total-row">Tổng tiền: <strong>₫ ${money(data.totalAmount)}</strong></td>
        </tr>
      </tbody>
    </table>

    <p class="clause">2. Ngày nhận hàng: ${escapeHtml(data.receiveDateText)}</p>
    <p class="clause">3. Hình thức thanh toán: ${escapeHtml(data.paymentMethodText)}</p>
    <p class="clause">4. Đơn đặt hàng qua fax, zalo, viber hoặc email có giá trị pháp lý như bản chính.</p>`
}

function lotBody(data: SalesOrderPrintData) {
    return `
    <p class="clause">Công ty chúng tôi có nhu cầu đặt hàng lô với số lượng và đơn giá cụ thể như sau:</p>

    <table class="grid">
      <thead>
        <tr>
          <th style="width:40px">STT</th>
          <th>Mặt hàng</th>
          <th style="width:90px">Số lượng (lít)</th>
          <th style="width:86px">Giá bán lẻ</th>
          <th style="width:92px">Chiết khấu</th>
          <th style="width:118px">Thành tiền</th>
          <th style="width:96px">Kho giao nhận</th>
        </tr>
      </thead>
      <tbody>
        ${data.lines.map(lotRow).join('')}
        <tr>
          <td colspan="7" class="right total-row">Tổng tiền: <strong>₫ ${money(data.totalAmount)}</strong></td>
        </tr>
      </tbody>
    </table>

    <p class="clause"><strong>Bảng đơn đặt hàng này bên mua và bên bán cam kết không hủy ngang.</strong></p>
    <p class="clause">Trong trường hợp bên mua/ bên bán có yêu cầu hủy ngang đơn hàng của lô trên, bên yêu cầu hủy sẽ đồng ý bồi thường 3% tổng giá trị lô hàng trên.</p>
    <p class="clause">Thời gian chuyển tiền bồi thường là 24h làm việc kể từ khi báo hủy đơn hàng.</p>

    <p class="clause">1. Thời gian xuất hóa đơn : ${escapeHtml(invoiceTimingText(data))}</p>
    <p class="clause">2. Thời gian thanh toán:</p>
    <p class="sub-clause"><span class="box"></span> Thanh toán cùng ngày đặt hàng cũng như ngày nhận hóa đơn của lô hàng</p>
    <p class="sub-clause"><span class="box"></span> Thỏa thuận khác:...........................................................</p>
    <p class="clause">3. Phương thức thanh toán : Bên mua thanh toán cho bên bán bằng ${escapeHtml(data.paymentMethodText.toLowerCase())}.</p>
    <p class="clause">4. Thời gian nhận hàng: ${escapeHtml(data.receiveDateText)}</p>
    <p class="clause dotted">5. Phương thức nhận hàng: ......................................................................................</p>
    <p class="clause">6. Đơn đặt hàng qua fax, zalo, viber hoặc email có giá trị pháp lý như bản chính.</p>`
}

export function renderSalesOrderPrintHtml(data: SalesOrderPrintData): string {
    const isLot = data.variant !== 'RETAIL'
    const title = isLot ? 'ĐƠN ĐẶT HÀNG LÔ' : 'ĐƠN ĐẶT HÀNG'

    return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(data.orderNo)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font-family: "Times New Roman", serif; font-size: 12.5px; color: #000; }

  .header { display: flex; justify-content: space-between; align-items: flex-start; }
  .header .left { width: 46%; }
  .header .right { width: 50%; text-align: center; }
  .company { font-weight: bold; text-transform: uppercase; }
  .nation { font-weight: bold; text-transform: uppercase; }
  .motto { font-weight: bold; border-bottom: 1px solid #000; display: inline-block; padding-bottom: 1px; }

  .doc-date { text-align: right; font-style: italic; margin: 14px 0 6px; }
  .doc-title { text-align: center; font-size: 20px; font-weight: bold; margin: 10px 0 12px; }
  .to-line { text-align: center; margin-bottom: 12px; }

  .field { margin: 5px 0; }
  .clause { margin: 7px 0; }
  .sub-clause { margin: 4px 0 4px 40px; }
  .box { display: inline-block; width: 11px; height: 11px; border: 1px solid #000; margin-right: 8px; vertical-align: -1px; }
  .dotted { color: #555; }
  .uom { text-align: right; font-style: italic; margin: 8px 0 4px; }

  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th, table.grid td { border: 1px solid #000; padding: 5px 6px; vertical-align: middle; }
  table.grid th { text-align: center; font-weight: bold; }
  .center { text-align: center; }
  .right { text-align: right; }
  .total-row { padding-right: 10px; }

  .signatures { display: flex; justify-content: space-around; margin-top: 34px; font-weight: bold; }
</style>
</head>
<body>
  <div class="header">
    <div class="left">
      <div class="company">${escapeHtml(data.buyerName)}</div>
      <div>Số: ${escapeHtml(data.orderNo)}</div>
    </div>
    <div class="right">
      <div class="nation">Cộng hòa xã hội chủ nghĩa Việt Nam</div>
      <div class="motto">Độc lập - Tự do - Hạnh phúc</div>
    </div>
  </div>

  <div class="doc-date">Ngày: ${dateText(data.orderDate)}</div>

  <div class="doc-title">${title}</div>

  <div class="to-line"><strong>Kính gửi: ${escapeHtml(data.sellerName)}</strong></div>

  <div class="field"><strong>Đơn vị đặt hàng: ${escapeHtml(data.buyerName)}</strong></div>
  ${
      isLot
          ? `<div class="field">Địa chỉ: ${escapeHtml(data.buyerAddress)}</div>
             <div class="field">Mã số thuế: ${escapeHtml(data.buyerTaxCode)}</div>`
          : `<div class="field">Mã số thuế: ${escapeHtml(data.buyerTaxCode)}</div>
             <div class="field">Địa chỉ: ${escapeHtml(data.buyerAddress)}</div>`
  }

  <p class="clause">Căn cứ hợp đồng mua bán xăng dầu giữa <strong>${escapeHtml(data.buyerName)}</strong> và <strong>${escapeHtml(data.sellerName)}</strong>.</p>

  ${isLot ? lotBody(data) : retailBody(data)}

  <div class="signatures">
    <div>XÁC NHẬN BÊN BÁN</div>
    <div>XÁC NHẬN BÊN MUA</div>
  </div>
</body>
</html>`
}
