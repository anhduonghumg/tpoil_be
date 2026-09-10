import { PRICE_DOC_COMPANY } from './company-profile'
import { TPOIL_LOGO_DATA_URI } from './logo.asset'
import type { PriceDocData } from './price-doc.types'

/** Bề ngang cố định của ảnh thông báo, tính bằng px — đủ nét để đọc trên điện thoại. */
export const PRICE_NOTICE_WIDTH = 1000

function escapeHtml(value: string) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
}

/** 23270 → "23.270". Bảng giá luôn là số nguyên đồng nên không cần phần thập phân. */
function money(value: number) {
    return Math.round(value).toLocaleString('vi-VN')
}

/** Chênh lệch in kèm dấu, và đó chính là thứ người đọc dò đầu tiên. */
function signed(value: number | null) {
    if (value == null) return '—'
    if (value === 0) return '0'
    return `${value > 0 ? '+' : '-'}${money(Math.abs(value))}`
}

function deltaClass(value: number | null) {
    if (value == null || value === 0) return 'flat'
    return value > 0 ? 'up' : 'down'
}

const WEEKDAY_FREE_DATE = (date: Date) => {
    const day = String(date.getDate()).padStart(2, '0')
    return `${day} tháng ${date.getMonth() + 1} năm ${date.getFullYear()}`
}

const HOUR_LABEL = (date: Date) =>
    `${String(date.getHours()).padStart(2, '0')}h${String(date.getMinutes()).padStart(2, '0')}`

/**
 * Ảnh "THÔNG BÁO GIÁ BÁN LẺ" gửi khách và đại lý.
 *
 * Bố cục bám đúng mẫu giấy công ty đang dùng: mỗi vùng một nhóm cột giá cũ/giá mới, riêng
 * vùng đầu có thêm cột tăng/giảm, và khi bảng đúng hai vùng thì có cột chênh lệch V2/V1.
 * Nhiều hơn hai vùng thì cột chênh lệch tự ẩn — không có nghĩa nào đúng để so.
 */
export function renderPriceNoticeHtml(data: PriceDocData) {
    const { regions, rows } = data
    const showGap = regions.length === 2
    // Vùng đầu 3 cột (cũ / mới / ±), các vùng sau 2 cột (cũ / mới).
    const regionSpan = (index: number) => (index === 0 ? 3 : 2)

    const groupHeader = regions
        .map(
            (region, index) =>
                `<th colspan="${regionSpan(index)}" class="grp">${escapeHtml(region.name)}</th>`,
        )
        .join('')

    const subHeader = regions
        .map(
            (_, index) =>
                `<th class="sub">Giá cũ</th><th class="sub new">Giá mới</th>` +
                (index === 0 ? `<th class="sub">Tăng +/ Giảm -</th>` : ''),
        )
        .join('')

    const body = rows
        .map((row) => {
            const cells = regions
                .map((region, index) => {
                    const cell = row.cells.find((item) => item.regionId === region.id)
                    const old = cell?.oldPrice == null ? '—' : money(cell.oldPrice)
                    const next = cell == null ? '—' : money(cell.newPrice)
                    const delta =
                        index === 0
                            ? `<td class="num delta ${deltaClass(cell?.delta ?? null)}">${signed(
                                  cell?.delta ?? null,
                              )}</td>`
                            : ''
                    return `<td class="num old">${old}</td><td class="num new">${next}</td>${delta}`
                })
                .join('')
            const gap = showGap
                ? `<td class="num gap">${row.regionGap == null ? '—' : money(row.regionGap)}</td>`
                : ''
            return `<tr><td class="product">${escapeHtml(row.productName)}</td>${cells}${gap}</tr>`
        })
        .join('')

    return `<!doctype html>
<html lang="vi"><head><meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: ${PRICE_NOTICE_WIDTH}px;
    padding: 18px 22px 14px;
    background: #ffffff;
    font-family: "Times New Roman", Times, serif;
    color: #111827;
  }
  .head { display: flex; align-items: center; gap: 18px; }
  .head img { width: 132px; height: auto; flex: 0 0 auto; }
  .head-text { flex: 1; text-align: center; line-height: 1.45; }
  .co { font-size: 19px; font-weight: 700; text-transform: uppercase; }
  .co-line { font-size: 14px; }
  .co-line b { font-weight: 700; }
  /* Mã số thuế giãn chữ như trên mẫu giấy, để đọc từng chữ số không bị dính. */
  .mst { letter-spacing: 1.5px; }
  .title { margin-top: 10px; text-align: center; }
  .title h1 { margin: 0; font-size: 25px; font-weight: 700; letter-spacing: 0.5px; }
  .title .apply { margin-top: 4px; font-size: 18px; font-weight: 700; color: #c0392b; }
  .title .greet { margin-top: 3px; font-size: 15px; font-style: italic; font-weight: 700; }
  .unit { margin: 10px 0 3px; text-align: right; font-size: 13px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #4b5563; padding: 6px 8px; font-size: 15px; }
  th { background: #ffffff; text-align: center; font-weight: 700; }
  th.grp { font-size: 16px; }
  th.sub { font-size: 14px; font-weight: 700; }
  th.sub.new, td.new { color: #c0392b; }
  th.first { width: 210px; }
  th.gap-head { width: 96px; }
  td.product { font-weight: 600; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  /* Nền màu chia ba nhóm số: giá cũ, giá mới, phần biến động — dò mắt theo hàng nhanh hơn. */
  td.old { background: #eef7e4; }
  td.new { background: #f5fbee; font-weight: 700; }
  /* Ô biến động đọc được ngay từ màu, không cần nhìn dấu: tăng xanh, giảm đỏ, đứng giá xám. */
  td.delta { color: #ffffff; font-weight: 700; text-align: center; }
  td.delta.up { background: #2e9e63; }
  td.delta.down { background: #c0392b; }
  td.delta.flat { background: #9ca3af; }
  /* Chênh lệch giữa hai vùng không phải tăng hay giảm, nên giữ màu trung tính của bảng. */
  td.gap { background: #2e9e63; color: #ffffff; font-weight: 700; text-align: center; }
  tbody tr:nth-child(odd) td.product { background: #fcfdf9; }
  .foot { margin-top: 12px; text-align: center; font-size: 15px; font-style: italic; font-weight: 700; }
</style></head>
<body>
  <div class="head">
    <img src="${TPOIL_LOGO_DATA_URI}" alt="" />
    <div class="head-text">
      <div class="co">${escapeHtml(PRICE_DOC_COMPANY.name)}</div>
      <div class="co-line"><b>Địa chỉ:</b> ${escapeHtml(PRICE_DOC_COMPANY.address)}</div>
      <div class="co-line">
        <b>Điện thoại:</b> ${escapeHtml(PRICE_DOC_COMPANY.phone)}
        &nbsp;&nbsp;&nbsp;
        <b>Hotline:</b> ${escapeHtml(PRICE_DOC_COMPANY.hotline)}
      </div>
      <div class="co-line mst">MST: ${escapeHtml(PRICE_DOC_COMPANY.taxCode)}</div>
    </div>
  </div>

  <div class="title">
    <h1>THÔNG BÁO GIÁ BÁN LẺ</h1>
    <div class="apply">Áp dụng từ ${HOUR_LABEL(data.effectiveFrom)} ngày ${WEEKDAY_FREE_DATE(
        data.effectiveFrom,
    )}</div>
    <div class="greet">Kính gửi: Quý Khách hàng!</div>
  </div>

  <div class="unit">ĐVT: đồng/lít</div>

  <table>
    <thead>
      <tr>
        <th class="first" rowspan="2">Mặt hàng</th>
        ${groupHeader}
        ${showGap ? '<th class="gap-head" rowspan="2">Chênh lệch<br />V2/V1</th>' : ''}
      </tr>
      <tr>${subHeader}</tr>
    </thead>
    <tbody>${body}</tbody>
  </table>

  <div class="foot">Trân trọng thông báo!</div>
</body></html>`
}
