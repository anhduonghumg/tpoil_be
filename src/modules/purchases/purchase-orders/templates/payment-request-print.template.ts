import fs from 'fs'
import path from 'path'

type PaymentRequestPrintRow = {
    supplierCode: string
    orderNo: string
    note?: string | null
    amount: number
    content: string
}

export type PaymentRequestPrintData = {
    cityText: string
    printDate: Date | string
    requesterName: string
    requesterDepartment: string

    beneficiaryName: string
    beneficiaryAccountNo?: string
    beneficiaryBankName?: string

    totalAmount: number
    totalAmountText: string

    rows: PaymentRequestPrintRow[]

    bankDepartmentLabel: string
    purchaseDepartmentLabel: string
    deputyDirectorLabel: string
    requesterLabel: string

    deputyDirectorName?: string
    requesterSignName?: string
}

function money(n: number) {
    return new Intl.NumberFormat('vi-VN').format(Math.round(n || 0))
}

function escapeHtml(input: string | null | undefined) {
    const s = String(input ?? '')
    return s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
}

function dateParts(value: Date | string) {
    const d = new Date(value)
    return {
        dd: String(d.getDate()).padStart(2, '0'),
        mm: String(d.getMonth() + 1).padStart(2, '0'),
        yyyy: String(d.getFullYear()),
    }
}

function getLogoDataUri() {
    const logoPath = path.resolve(process.cwd(), 'public/logo/logo_200.png')
    const buffer = fs.readFileSync(logoPath)
    const base64 = buffer.toString('base64')
    return `data:image/png;base64,${base64}`
}

export function renderPaymentRequestPrintHtml(data: PaymentRequestPrintData): string {
    const dp = dateParts(data.printDate)

    const rowsHtml = data.rows
        .map(
            (r) => `
      <tr>
        <td class="cell content-cell">${escapeHtml(r.content)}</td>
        <td class="cell center">${escapeHtml(r.supplierCode)}</td>
        <td class="cell center">${escapeHtml(r.orderNo)}</td>
        <td class="cell">${escapeHtml(r.note || '')}</td>
      </tr>
    `,
        )
        .join('')

    return `
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<title>Phiếu đề nghị thanh toán</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }

  body {
    font-family: "Times New Roman", serif;
    font-size: 14px;
    color: #000;
    margin: 0;
  }

  .page {
    width: 100%;
  }

  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 6px;
  }

  .header-right {
    width: 120px;
  }

  .logo-wrap {
    width: 120px;
    min-height: 78px;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .logo-wrap img {
    max-width: 100%;
    max-height: 78px;
    object-fit: contain;
  }

  .title-wrap {
    flex: 1;
    text-align: center;
  }

  .title {
    font-size: 20px;
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.2;
    margin-bottom: 4px;
  }

  .date-line {
    font-style: italic;
    font-size: 13px;
    line-height: 1.4;
  }

  .receiver {
    text-align: center;
    margin: 14px 0 16px;
    line-height: 1.5;
  }

  .receiver .label {
    font-style: italic;
    font-weight: 700;
  }

  .meta {
    margin: 4px 0 12px;
    line-height: 1.9;
  }

  .meta-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .meta-label {
    width: 130px;
  }

  .table {
    width: 100%;
    border-collapse: collapse;
    margin: 10px 0 8px;
    table-layout: fixed;
  }

  .table col:nth-child(1) { width: 44%; }
  .table col:nth-child(2) { width: 18%; }
  .table col:nth-child(3) { width: 20%; }
  .table col:nth-child(4) { width: 18%; }

  .cell, .head {
    border: 1px solid #000;
    padding: 7px 6px;
    vertical-align: top;
    font-size: 13px;
    word-break: break-word;
  }

  .head {
    text-align: center;
    font-weight: 700;
  }

  .center { text-align: center; }
  .right { text-align: right; }

  .amount-row td {
    font-weight: 700;
  }

  .amount-text {
    margin: 8px 0 14px;
    font-size: 14px;
  }

  .bank-info {
    line-height: 1.9;
    margin-bottom: 8px;
  }

  .bank-account-dots {
    display: inline-block;
    width: 420px;
    border-bottom: 1px dotted #000;
    vertical-align: middle;
    transform: translateY(-2px);
  }

  .commit {
    font-style: italic;
    font-weight: 700;
    margin: 10px 0 26px;
  }

  .signatures {
    display: grid;
    grid-template-columns: 1fr 1.35fr;
    column-gap: 36px;
    margin-top: 18px;
    align-items: start;
  }

  .sign-left,
  .sign-right {
    text-align: center;
  }

  .sign-block-title {
    font-weight: 700;
    text-transform: uppercase;
    line-height: 1.2;
    margin-bottom: 4px;
  }

  .sign-role {
    font-weight: 700;
    line-height: 1.2;
    margin-bottom: 2px;
  }

  .sign-note {
    font-style: italic;
    line-height: 1.2;
  }

  .sign-space {
    height: 110px;
  }

  .sign-name {
    font-weight: 700;
    line-height: 1.2;
  }

  .sign-right-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 18px;
    align-items: start;
  }

  .sign-right-col {
    text-align: center;
  }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo-wrap">
        <img src="${getLogoDataUri()}" alt="Logo" />
      </div>

      <div class="title-wrap">
        <div class="title">PHIẾU ĐỀ NGHỊ THANH TOÁN CHUYỂN KHOÁN</div>
        <div class="date-line">
          ${escapeHtml(data.cityText)}, ngày ${dp.dd} tháng ${dp.mm} năm ${dp.yyyy}
        </div>
      </div>

      <div class="header-right"></div>
    </div>

    <div class="receiver">
      <div><span class="label">Kính gửi:</span> - Bộ phận kế toán ngân hàng</div>
      <div>- Các phòng ban liên quan</div>
    </div>

    <div class="meta">
      <div class="meta-row">
        <div class="meta-label">Người đề nghị:</div>
        <div>${escapeHtml(data.requesterName)}</div>
      </div>
      <div class="meta-row">
        <div class="meta-label">Bộ phận:</div>
        <div>${escapeHtml(data.requesterDepartment)}</div>
      </div>
      <div style="margin-top: 8px;">Kính gửi đề nghị phê duyệt khoản thanh toán sau:</div>
    </div>

    <table class="table">
      <colgroup>
        <col />
        <col />
        <col />
        <col />
      </colgroup>
      <thead>
        <tr>
          <th class="head">Nội dung đề nghị</th>
          <th class="head">Mã nhà cung cấp</th>
          <th class="head">Mã đơn hàng</th>
          <th class="head">Ghi chú</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
        <tr class="amount-row">
          <td class="cell right" colspan="3">Tổng cộng:</td>
          <td class="cell right">đ ${money(data.totalAmount)}</td>
        </tr>
      </tbody>
    </table>

    <div class="amount-text">
      <strong>Tổng số tiền ghi bằng chữ:</strong>
      ${escapeHtml(data.totalAmountText)}
    </div>

    <div class="bank-info">
      <div>
        Tên tài khoản thụ hưởng:
        <strong> ${escapeHtml(data.beneficiaryName)}</strong>
      </div>
      <div>
        Số tài khoản thụ hưởng: .....................................................................................................................................
      </div>
      ${data.beneficiaryBankName ? `<div>Ngân hàng: <strong>${escapeHtml(data.beneficiaryBankName)}</strong></div>` : ''}
    </div>

    <div class="commit">
      Tôi xin cam đoan chịu hoàn toàn trách nhiệm trước công ty và pháp luật về nội dung kê khai nêu trên.
    </div>

    <div class="signatures">
      <div class="sign-left">
        <div class="sign-block-title">${escapeHtml(data.bankDepartmentLabel)}</div>
        <div class="sign-role">Kế Toán Ngân Hàng</div>
        <div class="sign-note">(ký, ghi rõ họ tên)</div>
        <div class="sign-space"></div>
        <div class="sign-name">&nbsp;</div>
      </div>

      <div class="sign-right">
        <div class="sign-block-title">${escapeHtml(data.purchaseDepartmentLabel)}</div>

        <div class="sign-right-grid">
          <div class="sign-right-col">
            <div class="sign-role">${escapeHtml(data.deputyDirectorLabel)}</div>
            <div class="sign-note">(ký, ghi rõ họ tên)</div>
            <div class="sign-space"></div>
            <div class="sign-name">${escapeHtml(data.deputyDirectorName || '')}</div>
          </div>

          <div class="sign-right-col">
            <div class="sign-role">${escapeHtml(data.requesterLabel)}</div>
            <div class="sign-note">(ký, ghi rõ họ tên)</div>
            <div class="sign-space"></div>
            <div class="sign-name">${escapeHtml(data.requesterSignName || '')}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
`
}
