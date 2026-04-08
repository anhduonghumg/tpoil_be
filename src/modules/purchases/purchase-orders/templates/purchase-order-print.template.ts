import { PurchaseOrderPrintData } from '../types/purchase-order-print.types'

function money(n: number) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))
}

function dateText(value: Date | string | null | undefined) {
    if (!value) return ''
    const d = new Date(value)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
}

function escapeHtml(input: string | null | undefined) {
    const s = String(input ?? '')
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

export function renderPurchaseOrderPrintHtml(data: PurchaseOrderPrintData): string {
    const rows = data.lines
        .map(
            (x) => `
      <tr>
        <td class="center">${x.index}</td>
        <td>${escapeHtml(x.productName)}</td>
        <td class="right">${money(x.qty)}</td>
        <td class="right">${money(x.unitPrice)}</td>
        <td class="right">${money(x.discountAmount)}</td>
        <td class="right">${money(x.payableUnitPrice)}</td>
        <td class="right"><strong>${money(x.lineTotal)}</strong></td>
      </tr>
    `,
        )
        .join('')

    return `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(data.orderNo)}</title>

<style>
  @page { size: A4; margin: 18mm 14mm; }

  body {
    font-family: "Times New Roman", serif;
    font-size: 13px;
    color: #000;
  }

  .header {
    display: flex;
    justify-content: space-between;
    margin-bottom: 10px;
  }

  .left-block, .right-block {
    width: 48%;
  }

  .right-block {
    text-align: center;
  }

  .company {
    font-weight: bold;
    text-transform: uppercase;
  }

  .doc-title {
    text-align: center;
    font-size: 26px;
    font-weight: bold;
    margin: 20px 0 10px;
  }

  .center-text {
    text-align: center;
  }

  .red {
    color: red;
  }

  .section {
    margin-top: 10px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
  }

  th, td {
    border: 1px solid #000;
    padding: 6px;
  }

  th {
    text-align: center;
    font-weight: bold;
  }

  .center {
    text-align: center;
  }

  .right {
    text-align: right;
  }

  .sign {
    display: flex;
    justify-content: space-between;
    margin-top: 40px;
    text-align: center;
    font-weight: bold;
  }
</style>
</head>

<body>

<div class="header">
  <div class="left-block">
    <div class="company">CÔNG TY TNHH VT&TMXD THIÊN PHÚC</div>
    <div>Số: ${escapeHtml(data.orderNo)}</div>
  </div>

  <div class="right-block">
    <div class="company">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</div>
    <div>Độc lập - Tự do - Hạnh phúc</div>
    <br/>
    <i>Thanh Hóa, ngày ${dateText(data.orderDate)}</i>
  </div>
</div>

<div class="doc-title">ĐƠN ĐẶT HÀNG</div>

<div class="center-text">
  Kính gửi: ${escapeHtml(data.supplierName)}
</div>

<div class="section">
  <div class="red">
    Căn cứ hợp đồng mua bán xăng dầu số: ${escapeHtml(data.contractNo || '...')}
  </div>

  <div>Đơn vị đặt hàng: CÔNG TY TNHH VT&TMXD THIÊN PHÚC</div>
  <div>Địa chỉ: ${escapeHtml(data.companyAddress || '')}</div>
  <div>Điện thoại: ${escapeHtml(data.companyPhone || '')}</div>

  <div>
    Công ty TNHH VT&TMXD Thiên Phúc đặt hàng với mặt hàng, số lượng, giá bán như sau:
  </div>
</div>

<table>
  <thead>
    <tr>
      <th>TT</th>
      <th>Mặt hàng</th>
      <th>Số lượng (Lít)</th>
      <th>Giá bán lẻ</th>
      <th>Chiết khấu</th>
      <th>Giá thanh toán</th>
      <th>Thành tiền (VND)</th>
    </tr>
  </thead>
  <tbody>
    ${rows}
    <tr>
      <td colspan="2" class="center"><strong>Tổng cộng</strong></td>
      <td class="right"><strong>${money(data.totalQty)}</strong></td>
      <td></td>
      <td></td>
      <td></td>
      <td class="right"><strong>${money(data.totalAmount)}</strong></td>
    </tr>
  </tbody>
</table>

<div class="section">
  <div>1. Giá trên đã bao gồm VAT, thuế bảo vệ môi trường,...</div>
  <div>2. Chất lượng: Theo TCVN hiện hành.</div>

  <div>
    3. Thông tin giao nhận:
    <br/>
    - Thời gian nhận hàng: ${escapeHtml(data.deliveryTimeText || '')}
    <br/>
    - Địa điểm giao hàng: ${escapeHtml(data.deliveryLocation || '')}
  </div>

  <div>
    4. Phương thức thanh toán: ${escapeHtml(data.paymentModeText || '')}
  </div>

  <div>
    5. Thời hạn thanh toán: ${escapeHtml(data.paymentDeadlineText || '')}
  </div>
</div>

<div class="sign">
  <div>XÁC NHẬN CỦA ${escapeHtml(data.supplierName)}</div>
  <div>XÁC NHẬN CỦA CÔNG TY THIÊN PHÚC</div>
</div>

</body>
</html>
`
}
