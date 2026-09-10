import {
    PRICE_DOC_COMPANY,
    PRICE_DOC_LEGAL_BASES,
    PRICE_DOC_RECIPIENTS,
    PRICE_DOC_SIGNER,
} from './company-profile'
import { TPOIL_LOGO_DATA_URI } from './logo.asset'
import { PRICE_DOC_SEAL_DATA_URI } from './seal.asset'
import type { PriceDocData } from './price-doc.types'

/** Biểu tượng địa chỉ và website ở măng-sét — vẽ bằng SVG cho khỏi phụ thuộc font emoji. */
const ICON_MAP =
    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M12 2a6 6 0 0 0-6 6c0 4.5 6 12 6 12s6-7.5 6-12a6 6 0 0 0-6-6zm0 8.4A2.4 2.4 0 1 1 12 5.6a2.4 2.4 0 0 1 0 4.8z"/>' +
    '</svg>'
const ICON_WEB =
    '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path d="M3 4h18a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1zm1 2v9h16V6H4zm4 13h8v2H8z"/>' +
    '</svg>'

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

function money(value: number) {
    return Math.round(value).toLocaleString('vi-VN')
}

/** "Ngày 03 tháng 09 năm 2026" — văn bản hành chính luôn viết đủ chữ. */
function longDate(date: Date) {
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `Ngày ${day} tháng ${month} năm ${date.getFullYear()}`
}

function shortDate(date: Date) {
    const day = String(date.getDate()).padStart(2, '0')
    const month = String(date.getMonth() + 1).padStart(2, '0')
    return `${day}/${month}/${date.getFullYear()}`
}

function basisSentence(data: PriceDocData) {
    if (!data.basisDocNo) return null
    const when = data.basisDocDate ?? data.effectiveFrom
    const day = String(when.getDate()).padStart(2, '0')
    const month = String(when.getMonth() + 1).padStart(2, '0')
    return (
        `Căn cứ công văn số: ${data.basisDocNo} ngày ${day} tháng ${month} năm ${when.getFullYear()} ` +
        'của Cục quản lý và phát triển thị trường trong nước thuộc Bộ Công Thương về việc ' +
        'Thông báo giá bán xăng dầu.'
    )
}

/**
 * Quyết định điều chỉnh, niêm yết giá bán lẻ — bản A4 để in, ký và đóng dấu.
 *
 * Cố ý CHỪA TRỐNG chỗ con dấu và chữ ký: dấu là thứ xác thực văn bản, nhúng ảnh dấu vào
 * mã nguồn thì ai chạy được hệ thống cũng phát hành được văn bản có dấu. In ra ký tay.
 */
export function renderPriceDecisionHtml(data: PriceDocData) {
    const { regions, rows } = data
    const basis = basisSentence(data)

    const header = regions
        .map((region) => `<th>${escapeHtml(region.name)}</th>`)
        .join('')

    const body = rows
        .map((row) => {
            const cells = regions
                .map((region) => {
                    const cell = row.cells.find((item) => item.regionId === region.id)
                    return `<td class="num">${cell == null ? '—' : money(cell.newPrice)}</td>`
                })
                .join('')
            return `<tr>
                <td class="product">${escapeHtml(row.productName)}</td>
                <td class="uom">${escapeHtml(row.uom)}</td>
                ${cells}
            </tr>`
        })
        .join('')

    const hour = `${String(data.effectiveFrom.getHours()).padStart(2, '0')} giờ ${String(
        data.effectiveFrom.getMinutes(),
    ).padStart(2, '0')} phút`

    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Times New Roman", Times, serif;
    font-size: 12.5pt;
    line-height: 1.38;
    color: #000000;
  }
  /* Vùng in của một trang A4 là 297mm trừ lề trên 8mm và lề dưới 6mm = 283mm. Chừa lại
     vài mm: mm quy ra px không tròn số, chỉ cần dư nửa pixel là Chrome đẩy sang trang
     thứ hai — đúng lỗi văn bản một trang mà in ra hai tờ. overflow:hidden là chốt chặn
     cuối, quyết định luôn phải gọn trong một trang. */
  .sheet {
    position: relative;
    height: 279mm;
    overflow: hidden;
    border: 1.2px solid #2f6b2f;
    padding: 8px 12px 0;
    display: flex; flex-direction: column;
  }
  /* Logo chìm sau chữ, canh giữa trang như mẫu giấy. Để mờ đủ để không cản đọc số giá.
     Dùng <img> chứ không phải background-image: bản in không phụ thuộc printBackground. */
  .watermark {
    position: absolute;
    left: 50%; top: 50%;
    transform: translate(-50%, -50%);
    width: 132mm;
    opacity: 0.13;
    z-index: 0;
  }
  /* Chữ nằm trên lớp logo chìm. */
  .body, .footer { position: relative; z-index: 1; }
  .body { flex: 1 1 auto; }
  /* Măng-sét: logo to bên trái, khối chữ bên phải, và dòng "Thanh Hóa, ngày…" nằm luôn
     trong khối chữ đó — đúng mẫu giấy, đồng thời tiết kiệm một dòng để văn bản vẫn
     gọn trong một trang khi logo phóng to. */
  .letterhead { display: flex; align-items: flex-start; gap: 12px; }
  .letterhead .brand { width: 130px; height: auto; flex: 0 0 auto; }
  .letterhead-text { flex: 1; text-align: right; line-height: 1.35; }
  .co { font-size: 12pt; font-weight: 700; text-transform: uppercase; }
  .co-line {
    display: flex; align-items: center; justify-content: flex-end; gap: 6px;
    font-size: 10.5pt; font-style: italic;
  }
  /* Biểu tượng vẽ thẳng bằng SVG: máy chủ không có font emoji, dán 🗺 vào là ra ô vuông. */
  .co-line .ic { width: 14px; height: 14px; fill: #2f6b2f; flex: 0 0 auto; }
  .co-line .web { color: #123c8a; text-decoration: underline; }
  .place { margin-top: 6px; text-align: right; font-size: 11.5pt; font-style: italic; }
  .docno { margin-top: 2px; font-size: 11.5pt; font-style: italic; font-weight: 700; }
  .title { margin-top: 12px; text-align: center; }
  .title h1 { margin: 0; font-size: 15.5pt; font-weight: 700; letter-spacing: 0.5px; }
  .title .sub { font-size: 11.5pt; font-style: italic; }
  .title .who { margin-top: 2px; font-size: 12.5pt; font-weight: 700; text-transform: uppercase; }
  .basis { margin-top: 10px; }
  .basis p { margin: 0 0 3px; text-indent: 28px; font-style: italic; text-align: justify; }
  .decide { margin: 9px 0 7px; text-align: center; font-size: 13.5pt; font-weight: 700; text-decoration: underline; }
  .article { margin-bottom: 6px; text-indent: 28px; text-align: justify; }
  .article b { text-decoration: underline; }
  table { width: 88%; border-collapse: collapse; margin: 8px auto 9px; }
  th, td { border: 1px solid #000000; padding: 4px 8px; font-size: 12pt; }
  /* Hàng tiêu đề tô nhạt như mẫu giấy, để tách khỏi phần số bên dưới. */
  th { background: #f1f1ea; text-align: center; font-weight: 700; }
  td.product { font-weight: 400; }
  td.uom { text-align: center; }
  td.num { text-align: center; font-variant-numeric: tabular-nums; }
  .vat { margin: 0 0 7px; text-indent: 28px; font-style: italic; text-align: justify; }
  .sign { display: flex; justify-content: space-between; align-items: flex-start; margin-top: 8px; }
  .recipients { width: 56%; font-size: 10pt; font-style: italic; }
  .recipients .lbl { font-weight: 700; text-decoration: underline; }
  .recipients ul { margin: 1px 0 0; padding-left: 12px; list-style: none; }
  .recipients li { margin-bottom: 0; }
  .signer { width: 42%; text-align: center; }
  .signer .role { font-weight: 700; font-size: 12pt; }
  /* Chừa chỗ cho con dấu và chữ ký. Trống thì in ra ký tay; có ảnh dấu thì nó nằm đè
     xuống dòng tên người ký, đúng kiểu đóng dấu thật. */
  .signer .space { position: relative; height: 28mm; }
  .signer .seal {
    position: absolute; left: 50%; top: 50%;
    /* Ảnh dấu có chữ ký lệch sang phải và viền trong suốt không cân, nên canh theo TÂM
       VÒNG DẤU đo được (x 45.4%, y 47.3% của ảnh) chứ không phải tâm khung ảnh.
       Kéo xuống thêm chút để dấu không chạm dòng "PHÓ GIÁM ĐỐC" mà đè nhẹ lên tên
       người ký — đúng kiểu đóng dấu tay. */
    transform: translate(-45.4%, -47.3%);
    width: 39mm; height: auto;
    /* multiply: nền trắng của ảnh scan tự biến mất, mực đỏ vẫn đè lên chữ như dấu thật —
       nên ảnh không bắt buộc phải tách nền sẵn. */
    mix-blend-mode: multiply;
  }
  .signer .name { font-weight: 700; font-size: 12.5pt; }
  /* Chân trang là dải xanh đặc chữ trắng, đúng như mẫu giấy đang dùng. */
  .footer {
    margin: 8px -12px 0; padding: 3px 12px;
    background: #2f6b2f; color: #ffffff;
    font-size: 8.5pt; font-style: italic;
    display: flex; justify-content: space-between; gap: 10px;
  }
</style></head>
<body>
  <div class="sheet">
    <img class="watermark" src="${TPOIL_LOGO_DATA_URI}" alt="" />
    <div class="body">
    <div class="letterhead">
      <img class="brand" src="${TPOIL_LOGO_DATA_URI}" alt="" />
      <div class="letterhead-text">
        <div class="co">${escapeHtml(PRICE_DOC_COMPANY.name)}</div>
        <div class="co-line">${ICON_MAP}<span>${escapeHtml(PRICE_DOC_COMPANY.address)}.</span></div>
        <div class="co-line">${ICON_WEB}<span>: <span class="web">${escapeHtml(PRICE_DOC_COMPANY.website)}</span></span></div>
        <div class="place">${escapeHtml(PRICE_DOC_COMPANY.place)}, ${longDate(data.effectiveFrom)}</div>
      </div>
    </div>
    ${data.decisionNo ? `<div class="docno">Số: ${escapeHtml(data.decisionNo)}</div>` : ''}

    <div class="title">
      <h1>QUYẾT ĐỊNH</h1>
      <div class="sub">(Về việc điều chỉnh, niêm yết Giá bán lẻ xăng dầu)</div>
      <div class="who">GIÁM ĐỐC ${escapeHtml(PRICE_DOC_COMPANY.name)}</div>
    </div>

    <div class="basis">
      ${PRICE_DOC_LEGAL_BASES.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      ${basis ? `<p>${escapeHtml(basis)}</p>` : ''}
    </div>

    <div class="decide">QUYẾT ĐỊNH:</div>

    <div class="article"><b>Điều 1</b>. Điều chỉnh, niêm yết giá bán lẻ xăng, dầu như sau:</div>

    <table>
      <thead>
        <tr><th>SẢN PHẨM</th><th>Đơn vị tính</th>${header}</tr>
      </thead>
      <tbody>${body}</tbody>
    </table>

    <div class="vat">
      Giá bán đã bao gồm VAT (nếu có - theo qui định của Nhà nước theo từng thời kỳ)
    </div>

    <div class="article">
      <b>Điều 2</b>. Quyết định này có hiệu lực từ ${hour}, ngày ${shortDate(data.effectiveFrom)}.
    </div>
    <div class="article">
      <b>Điều 3</b>. Các Ông/bà trưởng phòng Kinh doanh, Kế toán và thủ trưởng các đơn vị
      liên quan chịu trách nhiệm thi hành quyết định này./.
    </div>

    <div class="sign">
      <div class="recipients">
        <div class="lbl">Nơi nhận:</div>
        <ul>${PRICE_DOC_RECIPIENTS.map((line) => `<li>- ${escapeHtml(line)}</li>`).join('')}</ul>
      </div>
      <div class="signer">
        <div class="role">${escapeHtml(PRICE_DOC_SIGNER.onBehalfOf)}</div>
        <div class="role">${escapeHtml(PRICE_DOC_SIGNER.title)}</div>
        <div class="space">${PRICE_DOC_SEAL_DATA_URI ? `<img class="seal" src="${PRICE_DOC_SEAL_DATA_URI}" alt="" />` : ''}</div>
        <div class="name">${escapeHtml(PRICE_DOC_SIGNER.name)}</div>
      </div>
    </div>

    </div>

    <div class="footer">
      <span>${escapeHtml(PRICE_DOC_COMPANY.address)}</span>
      <span>${escapeHtml(PRICE_DOC_COMPANY.contact)}</span>
      <span>${escapeHtml(PRICE_DOC_COMPANY.website)}</span>
    </div>
  </div>
</body></html>`
}
