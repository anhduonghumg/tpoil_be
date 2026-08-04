
const TZ = 'Asia/Ho_Chi_Minh';
/**
 * Gọi DeepSeek để normalize order.
 * Trả về object JSON với fields: Đơn, Ngày, Khách hàng, Loại đơn, BKS, Lái xe, Details[]
 */


function makeDeepSeekCacheKey_(text) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    text,
    Utilities.Charset.UTF_8
  );

  return 'DS_' + digest
    .map(b => (b + 256).toString(16).slice(-2))
    .join('');
}

function normalizeWithDeepSeek(rawInput) {
  const API_KEY = "sk-070b49c7b62c44c4a8e2300a1d2777b4";
  const url = 'https://api.deepseek.com/chat/completions';

  if (!API_KEY) {
    throw new Error('Chưa cấu hình DEEPSEEK_API_KEY trong Script Properties.');
  }

  const safeInput = String(rawInput || '').trim().slice(0, 1500);
  if (!safeInput) {
    return {
      Đơn: '',
      Ngày: '',
      'Khách hàng': '',
      'Loại đơn': '',
      BKS: '',
      'Lái xe': '',
      Details: []
    };
  }

  const cache = CacheService.getScriptCache();
  const cacheKey = makeDeepSeekCacheKey_(safeInput);

  const cached = cache.get(cacheKey);
  if (cached) {
    return JSON.parse(cached);
  }

  const payload = {
  model: 'deepseek-v4-flash',
  messages: [
    {
      role: 'system',
      content: `
You are an order-normalization assistant.
Return ONLY valid JSON. No markdown. No commentary.

JSON keys must exactly be:
Đơn, Ngày, Khách hàng, Loại đơn, BKS, Lái xe, Details.

Details must be an array.
Each Details item must have exactly:
Loại hàng, Số lượng, Kho nhận.

If a value is missing, return "".
Do not add extra keys.

Allowed Loại hàng values:
Dầu 01, Dầu 05, Xăng, E5, E10, DO 0.1.

Product mapping rules:
- Dầu 01: dầu 01, dau 01, dầu01, dau01, D1, D01, DO001, DO 0,01, DO 0.01, DO 0,01S, DO 0.01S, Do 0.1.
- Dầu 05: dầu 05, dau 05, dầu05, dau05, DO, Do, D5, D05,DO 0.5 ,DO005, DO 0,05, DO 0.05.
- Xăng: xăng, xang, xăng 95, xang 95, A95, RON95, Mogas 95.
- E5: E5, xăng E5, xang E5, E5 RON92, E5RON92.
- E10: E10, xăng E10, xang E10.

Important:
Never guess Loại hàng.
Never default to Dầu 01 or Xăng.
D5, dầu, dầu05, DO005 always mean Dầu 05, never Dầu 01.

Quantity rules:
Keep quantity exactly as written.
Do not convert 21.385 to 21385 or 21.385 to 21.3850.
Remove only unit words like lít, lit.

Warehouse rules:
If warehouse appears once for the whole order, apply it to all Details.
If warehouse appears on each product line, use that line warehouse.
      `.trim()
    },
    {
      role: 'user',
      content: safeInput
    }
  ],
  temperature: 0,
  max_tokens: 2500,
  thinking: {
    type: 'disabled'
  },
  stream: false
};
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + API_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };


  try {
    let lastError = null;

    for (let i = 0; i < 1; i++) {
      const resp = UrlFetchApp.fetch(url, options);
      const code = resp.getResponseCode();
      const body = resp.getContentText();

      if (code >= 200 && code < 300) {
        const js = JSON.parse(body);
        let content = js.choices?.[0]?.message?.content || '';

        content = content
          .replace(/^\s*```(?:json)?\s*/i, '')
          .replace(/```/g, '')
          .replace(/`/g, '')
          .trim();

        const result = JSON.parse(content);

        cache.put(cacheKey, JSON.stringify(result), 300);

        return result;
      }

      lastError = new Error('HTTP ' + code + ': ' + body.slice(0, 300));

      if (body.includes('Bandwidth quota exceeded')) {
        throw new Error('DeepSeek đang bị giới hạn tạm thời. Giữ nguyên đơn, thử lại sau 10-20 giây.');
      }

      if (code === 429 || code === 503) {
        throw new Error('DeepSeek đang quá tải. Giữ nguyên đơn, thử lại sau vài giây.');
      }

      throw lastError;
    }

    throw lastError || new Error('DeepSeek request failed.');

  } catch (e) {
    SpreadsheetApp.getActiveSpreadsheet()
      .toast('AI normalize error: ' + e.message, 'DeepSeek Error', 5);

    return {
      Đơn: '',
      Ngày: '',
      'Khách hàng': '',
      'Loại đơn': '',
      BKS: '',
      'Lái xe': '',
      Details: []
    };
  }
}

function isOrderValid(commonData, details) {
  // 1) Kiểm tra các trường chung bắt buộc
  const requiredCommon = ['Đơn', 'Khách hàng', 'BKS', 'Lái xe'];
  for (const key of requiredCommon) {
    if (!commonData[key] || String(commonData[key]).trim() === '') {
      return false;
    }
  }

  // 2) Nếu details đã có (parse ra được >=1 dòng), mỗi dòng phải đủ 3 trường
  if (Array.isArray(details) && details.length > 0) {
    for (const d of details) {
      if (
        !d['Loại hàng'] || String(d['Loại hàng']).trim() === '' ||
        !d['Số lượng'] || String(d['Số lượng']).trim() === '' ||
        !d['Kho nhận'] || String(d['Kho nhận']).trim() === ''
      ) {
        return false;
      }
    }
    return true;
  }

  // 3) Fallback: nếu parseOrderInputMultiple đã đẩy commonData 
  //    thành detail khi thiếu details, thì kiểm thử lại ở commonData
  if (
    commonData['Loại hàng'] &&
    commonData['Số lượng'] &&
    commonData['Kho nhận']
  ) {
    return true;
  }

  // Còn lại, không hợp lệ
  return false;
}

function autoFixLineWithoutColon(line) {
  const keys = ['Đơn', 'Ngày', 'Khách hàng', 'Loại đơn', 'BKS', 'BSX', 'Lx', 'Lái xe'];
  for (const k of keys) {
    const re = new RegExp(`^(${k})\\s+(.+)$`, 'i');
    if (re.test(line)) {
      return line.replace(re, `$1: $2`);
    }
  }
  return line;
}

/**
 * Khử dấu tiếng Việt
 */

function stripAccents(str) {
  return (str || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "D");
}

/*******************************************************
 * 1) HÀM PHỤ TRỢ: Normalize chuỗi và chuẩn hóa BKS (BX)
 *******************************************************/
function normalizeString(str) {
  if (!str) return "";
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function normalizeDon(str) {
  if (!str) return "";
  // Chuẩn hóa Unicode: tách các dấu, sau đó loại bỏ các ký tự kết hợp và thay thế Đ, đ thành D, d
  return str.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/Đ/g, "D")
    .replace(/đ/g, "d")
    .toUpperCase();
}

function normalizeBKS(bks) {
  if (!bks) return "";

  bks = bks.replace(/\s*-\s*(?:Lx(?:e)?|Lái xe|Lai xe)[:]? *.+$/i, '').trim();

  // Xóa tất cả khoảng trắng và dấu chấm
  bks = bks.replace(/[\.\s]+/g, '');

  // Tách phần chữ và số
  const match = bks.match(/^([A-Za-zÀ-Ỹà-ỹ\d]+?)(\d+)$/);
  if (match) {
    return match[1].toUpperCase() + '-' + match[2];
  }

  return bks.toUpperCase();
}

function normalizeKey(key) {
  if (!key) return "";
  // Loại bỏ dấu, hạ thành chữ thường, bỏ khoảng trắng thừa
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

function normalizeWarehouseName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')    // bỏ dấu
    .replace(/[^\w\s]/g, '')            // bỏ punctuation
    .replace(/\s+/g, ' ')               // collapse whitespace
    .trim()
    .toLowerCase();
}

function capitalizeWords(str) {
  if (!str) return "";
  return str.split(' ').map(word => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }).join(' ');
}

/*******************************************************
 * Hàm parseLocalizedNumber:
 * Nếu chuỗi số có 1 dấu chấm và phần sau dấu có 3 ký tự (vd: "15.530")
 * thì loại bỏ dấu chấm (15.530 → 15530).
 *******************************************************/
// function parseLocalizedNumber(numStr) {
//   if (typeof numStr === 'string') {
//     let parts = numStr.split('.');
//     if (parts.length === 2 && parts[1].length === 3) {
//       return parseFloat(parts.join(''));
//     } else {
//       return parseFloat(numStr);
//     }
//   }
//   return numStr;
// }

function parseLocalizedNumber(value) {
  if (value === null || value === undefined || value === '') return 0;

  let s = String(value).trim();
  s = s.replace(/[^\d.,]/g, '');

  // 15.050 / 10.020 / 4.515 => 15050 / 10020 / 4515
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    return Number(s.replace(/\./g, ''));
  }

  // AI có thể làm mất số 0 cuối: 15.05 => hiểu là 15.050
  if (/^\d{1,3}\.\d{1,2}$/.test(s)) {
    const [left, right] = s.split('.');
    return Number(left + right.padEnd(3, '0'));
  }

  // 15,050 => 15050
  if (/^\d{1,3},\d{3}$/.test(s)) {
    return Number(s.replace(',', ''));
  }

  // 15,5 => 15.5 nếu thực sự là số thập phân
  if (/^\d+,\d{1,2}$/.test(s)) {
    return Number(s.replace(',', '.'));
  }

  return Number(s) || 0;
}

/*******************************************************
 * 2) HÀM PHỤ TRỢ & PARSE INPUT (Full Order Format)
 * Tách thông tin chung (commonData) và mảng chi tiết (details).
 *******************************************************/

function parseOrderInputMultiple(input) {
  // 0) Chuẩn hóa newline
  input = input.replace(/\r\n?/g, '\n');

  // 1) Đảm bảo mỗi label bắt buộc đều nằm đầu dòng
  input = input.replace(
    /\b(Đơn|Khách hàng|Loại đơn|BKS|A95|E5|Do)\s*:/gi,
    '\n$1:'
  );

  // 2) Chuẩn hóa ký tự
  input = input
    .replace(/_/g, '-')
    .replace(/–/g, '-')
    .replace(/\s*=\s*/g, ':');

  // 3) Lấy mảng các dòng, loại bỏ rỗng
  const lines = input
    .split('\n')
    .map(l => l.trim())
    .filter(l => l);

  const commonData = {};
  const details = [];

  // Bảng mapping key dạng thường → key chuẩn
  const keyMapping = {
    "khach hang": "Khách hàng",
    "loai don": "Loại đơn",
    "loai hang": "Loại hàng",
    "bks": "BKS",
    "bsx": "BKS",
    "bxs": "BKS",
    "lx": "Lái xe",
    "lxe": "Lái xe",
    "lai xe": "Lái xe",
    "lái xe": "Lái xe"
  };

  lines.forEach(line => {
    // 4) Thêm dấu ":" nếu thiếu
    line = autoFixLineWithoutColon(line);
    if (!line) return;

    // 5) Bắt "Đơn: <số>"
    const donMatch = normalizeDon(line).match(/^(DON)\s*:?\s*(\d+)$/i);
    if (donMatch) {
      commonData["Đơn"] = donMatch[2];
      return;
    }

    // 6) Xử lý dòng key:value
    if (line.includes(':')) {
      const [rawKey, ...rest] = line.split(':');
      const normKey = normalizeKey(rawKey.trim());
      if (keyMapping[normKey]) {
        let val = rest.join(':').trim();
        // nếu có dấu "-" chia thêm subfields
        if (val.includes('-')) {
          const segs = val.split(/\s*-\s*/);
          commonData[keyMapping[normKey]] = segs.shift().trim();
          segs.forEach(seg => {
            if (seg.includes(':')) {
              const [k2, ...r2] = seg.split(':');
              const nk2 = normalizeKey(k2.trim());
              if (keyMapping[nk2]) {
                commonData[keyMapping[nk2]] = r2.join(':').trim();
              } else {
                commonData[nk2] = r2.join(':').trim();
              }
            } else {
              commonData[keyMapping[normKey]] += ' - ' + seg.trim();
            }
          });
        } else {
          commonData[keyMapping[normKey]] = val;
        }
        return;
      }
    }

    // 7) Thử parse detail: "Loại hàng - Số lượng - Kho nhận"
    try {
      const detail = parseDetailFlexible(line);
      details.push(detail);
    } catch (err) {
      // fallback: nếu vẫn chứa ":", thử split
      if (line.includes(':')) {
        const [key, ...rest] = line.split(':');
        const val = rest.join(':').trim();
        const code = getFuelTypeName(key);
        if (code !== key.toUpperCase()) {
          const parts = val.split('-').map(s => s.trim());
          if (parts.length >= 2) {
            details.push({
              "Loại hàng": key.toUpperCase(),
              "Số lượng": parts[0],
              "Kho nhận": parts[1]
            });
          } else {
            commonData[key] = val;
          }
        } else {
          const nk = normalizeKey(key);
          const mapped = keyMapping[nk] || key;
          commonData[mapped] = val;
        }
      } else {
        // fallback tiếp: "Key Value"
        const m = line.match(/^(\S+)\s+(.+)/);
        if (m) {
          let k = m[1].trim();
          const rest = m[2].trim();
          const lk = normalizeKey(k);
          if (keyMapping[lk]) k = keyMapping[lk];
          commonData[k] = rest;
        }
      }
    }
  });

  // 8) Nếu có BKS nhưng thiếu Lái xe, tách từ BKS
  if (commonData["BKS"] && !commonData["Lái xe"]) {
    const regex = /\s*-\s*(?:Lx(?:e)?|Lái xe|Lai xe)[:]? *(.+)$/i;
    const m = commonData["BKS"].match(regex);
    if (m) {
      commonData["Lái xe"] = m[1].trim();
      commonData["BKS"] = commonData["BKS"]
        .replace(regex, '')
        .replace(/\./g, '')
        .trim();
    }
  }

  // 9) Nếu chưa có detail riêng nhưng commonData chứa đủ 3 trường, tạo 1 detail
  if (
    details.length === 0 &&
    commonData["Loại hàng"] &&
    commonData["Số lượng"] &&
    commonData["Kho nhận"]
  ) {
    details.push({
      "Loại hàng": commonData["Loại hàng"],
      "Số lượng": commonData["Số lượng"],
      "Kho nhận": commonData["Kho nhận"]
    });
  }

  return { commonData, details };
}


function parseDetailFlexible(line) {
  // const unified = line.replace(/:/g, '-');
  const unified = line.replace(/[:_–]/g, '-');
  return parseSimpleDetail(unified);
}

function parseSimpleDetail(detailLine) {
  detailLine = detailLine.replace(/Chi tiết:/i, "").trim();
  const parts = detailLine.split(/\s*-\s*/);
  if (parts.length !== 3) {
    throw new Error("Định dạng chi tiết không đúng. Vui lòng nhập: Mã - Số lượng - Kho nhận");
  }
  return {
    "Loại hàng": parts[0].trim(),
    "Số lượng": parts[1].trim(),
    "Kho nhận": parts[2].trim()
  };
}

/*******************************************************
 * 3) HÀM MAPPING MÃ LOẠI HÀNG -> TÊN ĐẦY ĐỦ
 *******************************************************/

function getFuelTypeName(code) {
  const raw = String(code || "").trim();

  const normalized = stripAccents(raw)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

  const compact = normalized
    .replace(/\s+/g, "")
    .replace(/,/g, ".");

  // =========================
  // DẦU DO 0.05S / DẦU 05
  // Nhận các kiểu: DO, DO005, DO 05, DO 0,05, DO 0.05, DO 0,5, DO 0.5
  // =========================
  if (
    compact === "DAU" ||
    compact === "DO" ||
    compact === "D05" ||
    compact === "DO05" ||
    compact === "DO005" ||
    compact === "DAU05" ||
    compact === "DAUDIEZEN0.05S" ||
    compact === "DO0.05" ||
    compact === "DO0.05S" ||
    compact === "DO0.5" ||
    compact === "DO0.5S"
  ) {
    return "Dầu Diezen 0.05S";
  }

  // =========================
  // DẦU DO 0.001S / DẦU 01
  // =========================
  if (
    compact === "D01" ||
    compact === "DO01" ||
    compact === "DO001" ||
    compact === "DO0001" ||
    compact === "DAU01" ||
    compact === "DAUDIEZEN0.001S" ||
    compact === "DO0.001" ||
    compact === "DO0.001S" ||
    compact === "DO0.01" ||
    compact === "DO0.01S"
  ) {
    return "Dầu Diezen 0.001S";
  }

  // =========================
  // XĂNG
  // =========================
  if (
    compact === "E5" ||
    compact === "XANGE5" ||
    compact === "E5RON92" ||
    compact === "XANGE5RON92"
  ) {
    return "Xăng E5 RON92";
  }

  if (
    compact === "E10" ||
    compact === "XANGE10" ||
    compact === "E10RON95" ||
    compact === "XANGE10RON95" ||
    compact === "XANGE10RON95III"
  ) {
    return "Xăng E10 RON95-III";
  }

  if (
    compact === "XANG" ||
    compact === "XANG95" ||
    compact === "A95" ||
    compact === "RON95" ||
    compact === "MOGAS95"
  ) {
    return "Xăng E10 RON95-III";
  }

  // Fallback mềm
  if (compact.includes("E10")) {
    return "Xăng E10 RON95-III";
  }

  if (compact.includes("E5")) {
    return "Xăng E5 RON92";
  }

  if (
    compact.includes("005") ||
    compact.includes("0.05") ||
    compact.includes("0.5") ||
    compact.includes("05")
  ) {
    return "Dầu Diezen 0.05S";
  }

  if (
    compact.includes("001") ||
    compact.includes("0.001") ||
    compact.includes("0.01") ||
    compact.includes("01")
  ) {
    return "Dầu Diezen 0.001S";
  }

  return raw;
}


/*******************************************************
 * 4) HÀM TÌM DÒNG TRỐNG CHO BẢNG TÍNH RÚT GỌN
 *******************************************************/
function getNextEmptyRowCondensed(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 3) {
    return 3;
  }
  const startRow = 3;
  const numRows = lastRow - startRow + 1;
  const data = sheet.getRange(startRow, 4, numRows, 5).getValues();
  for (let i = 0; i < data.length; i++) {
    const rowArr = data[i];
    // rowArr = [bx, tenLX, ???, loaiHang, luong]
    if (!rowArr[0] && !rowArr[1] && !rowArr[3] && !rowArr[4]) {
      return startRow + i;
    }
  }
  return lastRow + 1;
}

/*******************************************************
 * 5) HÀM XỬ LÝ ĐƠN HÀNG RÚT GỌN TỪ INPUT FULL (đã tối ưu setValues)
 *******************************************************/
function processFullOrderCondensed(e) {
  const sheet = e.range.getSheet();
  const input = e.value;

  let orderBlocks = input.split(/\n\s*\n/);
  if (orderBlocks.length === 0 || (orderBlocks.length === 1 && orderBlocks[0].trim() === "")) {
    orderBlocks = [input];
  }

  const rowsToWrite = [];

  orderBlocks.forEach(orderText => {
    orderText = orderText.trim();
    if (!orderText) return;
    const orderData = parseOrderInputMultiple(orderText);
    const { commonData, details } = orderData;
    const bks = commonData["BKS"] ? normalizeBKS(commonData["BKS"]) : "";
    const tenLX = commonData["Lái xe"] ? commonData["Lái xe"].toUpperCase() : "";

    details.forEach(detail => {
      const loaiHangCode = detail["Loại hàng"] || "";
      const loaiHang = getFuelTypeName(loaiHangCode);
      const luongRaw = detail["Số lượng"] || "";
      const luong = parseLocalizedNumber(luongRaw.replace(/[^\d.]/g, '').trim()) || 0;

      const targetRow = getNextEmptyRowCondensed(sheet);

      const rowData = [
        "'"+ bks,                // col D
        capitalizeWords(tenLX), // col E
        "",                 // col F => trống
        loaiHang,           // col G
        luong               // col H
      ];
      rowsToWrite.push({ rowIndex: targetRow, values: rowData });
    });
  });

  rowsToWrite.forEach(item => {
    sheet.getRange(item.rowIndex, 4, 1, 5).setValues([item.values]);
  });

  sheet.getRange("L1").clearContent();
}

/*******************************************************
 * 6) HÀM ĐỌC & CACHE MAPPING ĐỐI TÁC, KHO
 *******************************************************/
function buildPartnerMapping_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("1. DM đối tác");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const data = sheet.getRange(2, 2, lastRow - 1, 2).getValues();
  const mapping = {};
  data.forEach(row => {
    const fullName = row[0] ? row[0].toString().trim() : "";
    const aliases = row[1] ? row[1].toString().trim() : "";
    if (aliases) {
      aliases.split(',').forEach(alias => {
        alias = alias.trim();
        if (alias) {
          mapping[normalizeString(alias)] = fullName;
        }
      });
    }
  });
  return mapping;
}

function getPartnerNameByAbbrev(abbrev) {
  const cache = CacheService.getScriptCache();
  const cacheKey = "partnerMapping";
  const key = normalizeString(abbrev || "");
  const mappingStr = cache.get(cacheKey);
  if (mappingStr) {
    const mapping = JSON.parse(mappingStr);
    return mapping[key] || "N/A";
  } else {
    const mapping = buildPartnerMapping_();
    cache.put(cacheKey, JSON.stringify(mapping), 21600);
    return mapping[key] || "N/A";
  }
}

function buildWarehouseMapping_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Chiết Khấu TB");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
  const mapping = {};
  data.forEach(row => {
    let rawName = row[0] ? row[0].toString().trim() : "";
    let name = rawName.replace(/[.,;:]+$/, '').trim();
    const maKho = row[1] ? row[1].toString().trim() : "";
    if (!maKho) return;
    const aliases = maKho.split(',');
    const info = {
      name: name,
      DO: row[2] ? row[2].toString().trim() : "",
      DO001: row[3] ? row[3].toString().trim() : "",
      E5: row[4] ? row[4].toString().trim() : "",
      // A95: row[5] ? row[5].toString().trim() : "",
      // A95V: row[6] ? row[6].toString().trim() : "",
      E10: row[7] ? row[7].toString().trim() : "",
    };
    aliases.forEach(alias => {
      const cleanAlias = alias.replace(/[.,;:]+$/, '').trim();
      mapping[normalizeString(cleanAlias)] = info;
    });
  });
  return mapping;
}

function getWarehouseMapping() {
  const cache = CacheService.getScriptCache();
  const cacheKey = "warehouseMappingFull";
  const mappingStr = cache.get(cacheKey);
  if (mappingStr) {
    return JSON.parse(mappingStr);
  } else {
    const mapping = buildWarehouseMapping_();
    cache.put(cacheKey, JSON.stringify(mapping), 21600);
    return mapping;
  }
}

function resetWarehouseCache() {
  const cache = CacheService.getScriptCache();
  cache.remove("warehouseMappingFull");
  let userEmail = Session.getActiveUser().getEmail();
  if (!userEmail) { userEmail = "Người dùng"; }
  SpreadsheetApp.getActiveSpreadsheet().toast("Warehouse cache has been reset!", "Thông báo", 3);
  sendEmailNotification(userEmail);
}

function resetPartnerCache() {
  const cache = CacheService.getScriptCache();
  cache.remove("partnerMapping");
  SpreadsheetApp.getActiveSpreadsheet().toast("Partner cache has been reset!", "Thông báo", 3);
}

/*******************************************************
 * 6.1) HÀM ĐỌC TỒN KHO (không dùng cache để đảm bảo chính xác)
 *******************************************************/
function buildStockMapping_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("Tồn Kho");
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  // A..m: 13 cột
  const data = sheet.getRange(2, 1, lastRow - 1, 13).getValues();
  const stockMapping = {};
  data.forEach(row => {
    const tenKho = row[0] ? row[0].toString().trim() : "";
    if (!tenKho) return;

    // G..K = index 7..12
    const tonDO = parseFloat(row[7]) || 0;
    const tonDO001 = parseFloat(row[8]) || 0;
    const tonE5 = parseFloat(row[9]) || 0;
    const tonA95 = parseFloat(row[10]) || 0;
    const tonA95V = parseFloat(row[11]) || 0;
    const tonE10 = parseFloat(row[12]) || 0;

    const normKho = normalizeString(tenKho);
    stockMapping[normKho] = {
      DO: tonDO,
      DO001: tonDO001,
      E5: tonE5,
      // A95: tonA95,
      // A95V: tonA95V,
      E10: tonE10,
    };
  });
  return stockMapping;
}

/*******************************************************
 * 7) HÀM XỬ LÝ NHẬP MỚI VỚI NHIỀU CHI TIẾT ĐƠN HÀNG
 * -- ĐÃ CHỈNH SỬA để chỉ ghi cột C..V & kiểm tra dòng cuối ở cột J.
 *******************************************************/
function processNewRow(e) {
  const sheet = e.range.getSheet();
  let success = false;
  try {
    const rawInput = e.value;
    const orderData = parseOrderInputMultiple(e.value);
    let { commonData, details } = orderData;

    if (!isOrderValid(commonData, details)) {
      // duongna thêm 28/04/2026
      const aiCache = CacheService.getScriptCache();
      if (aiCache.get('DEEPSEEK_THROTTLE')) {
        SpreadsheetApp.getActiveSpreadsheet()
          .toast("AI đang xử lý quá nhanh, vui lòng thử lại sau vài giây.", "DeepSeek", 5);
        return;
      }
      aiCache.put('DEEPSEEK_THROTTLE', '1', 8);
      // end
      SpreadsheetApp.getActiveSpreadsheet().toast("sai đơn đang dùng ai");

      const normalized = normalizeWithDeepSeek(rawInput);
      commonData = {
        Đơn: normalized.Đơn,
        'Khách hàng': normalized['Khách hàng'],
        'Loại đơn': normalized['Loại đơn'],
        BKS: normalized.BKS,
        'Lái xe': normalized['Lái xe']
      };
      details = normalized.Details;
      // SpreadsheetApp.getActiveSpreadsheet().toast(commonData);
    }

    if (details.length === 0) {
      throw new Error("Không có thông tin chi tiết đơn hàng.");
    }

    if (!commonData["Loại đơn"] && commonData["Loại hàng"]) {
      commonData["Loại đơn"] = commonData["Loại hàng"];
    }

    // Đồng bộ key "Lxe" => "Lái xe" nếu còn sót
    if (commonData.hasOwnProperty("Lxe")) {
      commonData["Lái xe"] = commonData["Lxe"];
      delete commonData["Lxe"];
    }

    const warehouseMapping = getWarehouseMapping();
    const stockMapping = buildStockMapping_(); // Đọc tồn kho mới nhất

    // Trước đây là colNumber=2 (cột B), nay đổi sang 10 (cột J)
    let lastDataRow = getLastDataRow(sheet, 10);
    let newRowIndex = lastDataRow + 1;

    const newRows = [];
    const formulas = [];
    const flaggedRows = [];

    details.forEach(detail => {
      const mergedData = Object.assign({}, commonData, detail);

      // Đối tác
      if (mergedData['Khách hàng']) {
        mergedData['Khách hàng'] = getPartnerNameByAbbrev(mergedData['Khách hàng']);
      }
      // Loại hàng => Tên đầy đủ
      if (mergedData['Loại hàng']) {
        mergedData['Loại hàng'] = getFuelTypeName(mergedData['Loại hàng']);
      }
      // Kho nhận => mapping
      let origWarehouseCode = mergedData['Kho nhận'] || '';
      if (origWarehouseCode) {
        origWarehouseCode = origWarehouseCode.replace(/[.,;:]+$/, '').trim();
        origWarehouseCode = normalizeString(origWarehouseCode.toUpperCase());
      }
      const warehouseInfo = warehouseMapping[origWarehouseCode] || null;
      // const rawKho = mergedData['Kho nhận'] || '';
      // const normKhoKey = normalizeWarehouseName(rawKho);
      // const warehouseInfo = warehouseMapping[normKhoKey] || null;
      mergedData['Kho nhận'] = warehouseInfo ? warehouseInfo.name : "";

      // BKS
      if (mergedData['BKS']) {
        mergedData['BKS'] = normalizeBKS(mergedData['BKS']);
      }

      // Ép kiểu số
      // let qtyStr = (mergedData['Số lượng'] || "").toString().replace(/[^\d.]/g, '').trim() || "0";
      // mergedData['Số lượng'] = parseLocalizedNumber(qtyStr);

      mergedData['Số lượng'] = parseLocalizedNumber(mergedData['Số lượng']);

      // Trường mặc định
      mergedData['Đơn'] = mergedData['Đơn'] || "N/A";
      mergedData['Ngày'] = mergedData['Ngày'] || "";
      mergedData['Lái xe'] = capitalizeWords(mergedData['Lái xe']);
      mergedData['Loại đơn'] = mergedData['Loại đơn'] || "";

      // Kiểm tra tồn kho
      const finalWarehouseName = mergedData['Kho nhận'] || "";
      const normWarehouseName = normalizeString(finalWarehouseName);
      const fuelTypeCode = getFuelTypeCodeFromName(mergedData["Loại hàng"]);
      const requestedQty = mergedData['Số lượng'];

      let isOutOfStock = false;
      const currentStockObj = stockMapping[normWarehouseName];
      if (!currentStockObj) {
        SpreadsheetApp.getActiveSpreadsheet().toast(
          "Không tìm thấy kho: " + finalWarehouseName,
          "Cảnh báo", 5
        );
      } else {
        const currentStock = currentStockObj[fuelTypeCode] || 0;
        if (requestedQty > currentStock) {
          SpreadsheetApp.getActiveSpreadsheet().toast(
            "Kho " + finalWarehouseName + " không đủ tồn cho " + fuelTypeCode
            + ". Yêu cầu: " + requestedQty + ", tồn: " + currentStock,
            "Cảnh báo", 5
          );
          isOutOfStock = true;
        }
      }

      // Tạo mảng dữ liệu 20 cột, tương ứng cột C..V
      const newRowData = prepareNewRow(newRowIndex, mergedData, warehouseInfo);
      newRows.push(newRowData);

      if (isOutOfStock) {
        flaggedRows.push(newRowIndex);
      }

      // Ghi công thức cột Q (physical col 17)
      const formula = `=IF(OR(N${newRowIndex}=""; O${newRowIndex}=""; P${newRowIndex}=""); ""; (N${newRowIndex} + O${newRowIndex} - P${newRowIndex}))`;
      formulas.push({ row: newRowIndex, formula });

      newRowIndex++;
    });

    // Ghi dữ liệu 1 lần: C..V = 20 cột (3..22)
    if (newRows.length > 0) {
      const startRow = lastDataRow + 1;
      sheet.getRange(startRow, 3, newRows.length, 20).setValues(newRows);

      // Đặt công thức CK cuối vào cột Q (col 17)
      formulas.forEach(item => {
        sheet.getRange(item.row, 17).setFormula(item.formula);
      });

      // Tô đỏ các dòng thiếu tồn
      flaggedRows.forEach(row => {
        sheet.getRange(row, 1, 1, 21).setBackground("red");
      });
    }

    success = true;
    // e.range.clearContent();
    if (success) {
      // Xoá nội dung ô M1
      e.range.clearContent();
    }

  } catch (err) {
    Logger.log("Error in processNewRow: " + err.message);
  }
}

/*******************************************************
 * 7.1) HÀM KIỂM TRA TỒN KHO CHO DÒNG (KHI NHẬP THỦ CÔNG)
 *******************************************************/
function checkStockForRow(sheet, row, oldQty) {
  var dateCell = sheet.getRange(row, 5).getValue();
  var today = Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy");
  var rowDate = (dateCell instanceof Date)
    ? Utilities.formatDate(dateCell, "Asia/Ho_Chi_Minh", "dd/MM/yyyy")
    : dateCell.toString().trim();

  // Nếu đơn không thuộc ngày hôm nay => xóa nền
  if (rowDate !== today) {
    sheet.getRange(row, 1, 1, 21).setBackground("white");
    return;
  }

  var loaiHang = sheet.getRange(row, 11).getValue();
  var soLuongCell = sheet.getRange(row, 13).getValue();
  var khoNhan = sheet.getRange(row, 19).getValue();

  var newQty = parseLocalizedNumber(soLuongCell.toString().replace(/[^\d.]/g, '').trim()) || 0;
  oldQty = oldQty
    ? parseLocalizedNumber(oldQty.toString().replace(/[^\d.]/g, '').trim())
    : 0;
  var additionalQty = newQty > oldQty ? (newQty - oldQty) : 0;

  var normKho = normalizeString(khoNhan);
  var fuelTypeCode = getFuelTypeCodeFromName(loaiHang);

  var stockMapping = buildStockMapping_();
  var currentStockObj = stockMapping[normKho];
  if (!currentStockObj) {
    sheet.getRange(row, 1, 1, 21).setBackground("white");
    return;
  }
  var availableStock = currentStockObj[fuelTypeCode] || 0;

  // Nếu phần tăng thêm > tồn => tô đỏ, else reset trắng
  if (additionalQty > availableStock) {
    sheet.getRange(row, 1, 1, 21).setBackground("red");
  } else {
    sheet.getRange(row, 1, 1, 21).setBackground("white");
  }
}

/*******************************************************
 * 8) HÀM TÁI TÍNH CK CHO DÒNG
 *******************************************************/
function recalcCKForRow(sheet, row) {
  try {
    // Lấy toàn bộ 22 cột A..V (như ban đầu)
    const rowValues = sheet.getRange(row, 1, 1, 22).getValues()[0];
    let loaiDon = rowValues[8];         // cột I
    let loaiHangInput = rowValues[10];  // cột K
    const khoNhan = rowValues[18];      // cột S
    let ckdc = rowValues[14];           // cột O

    const fullFuelName = getFuelTypeName(loaiHangInput);
    rowValues[10] = fullFuelName;

    let ck = 0;
    if (String(loaiDon).trim().toLowerCase() === "rút lô hàng gửi") {
      ck = 0;
      ckdc = 0;
      rowValues[14] = ckdc;
    } else {
      const fuelCode = getFuelTypeCodeFromName(fullFuelName);
      const warehouseMapping = getWarehouseMapping();
      let warehouseInfo = null;
      for (let code in warehouseMapping) {
        if (warehouseMapping[code].name === khoNhan) {
          warehouseInfo = warehouseMapping[code];
          break;
        }
      }
      if (warehouseInfo && fuelCode && warehouseInfo[fuelCode] !== "") {
        ck = parseFloat(warehouseInfo[fuelCode].replace(",", ".")) || 0;
      }
    }
    rowValues[13] = ck;

    const leftPart = rowValues.slice(0, 16);  // A..P
    sheet.getRange(row, 1, 1, 16).setValues([leftPart]);
    const rightPart = rowValues.slice(17, 22); // S..V
    sheet.getRange(row, 18, 1, 5).setValues([rightPart]);

  } catch (err) {
    Logger.log("Lỗi recalcCKForRow: " + err.message);
  }
}

/*******************************************************
 * 9) HÀM PHỤ TRỢ: Lấy dòng cuối cùng có dữ liệu theo cột chỉ định
 *******************************************************/
function getLastDataRow(sheet, colNumber) {
  let lastRow = sheet.getLastRow();
  if (lastRow < 3) {
    return 2;
  }
  let data = sheet.getRange(3, colNumber, lastRow - 2, 1).getValues();
  for (let i = data.length - 1; i >= 0; i--) {
    let cellVal = data[i][0];
    if (cellVal !== "" && cellVal !== null && cellVal !== undefined) {
      return i + 3;
    }
  }
  return 2;
}

/*******************************************************
 * 10) HÀM PHỤ TRỢ: Lấy mã loại hàng từ tên đầy đủ
 *******************************************************/
function getFuelTypeCodeFromName(fullName) {
  const fullMapping = {
    "DAU DIEZEN 0.05S": "DO",
    "DAU DIEZEN 0.001S": "DO001",
    "XANG E5 RON92": "E5",
    // "XANG RON95-III": "A95",
    // "XANG RON95-V": "A95V",
    "XANG E10 RON95-III": "E10"
  };
  const normFullName = normalizeString(fullName);
  return fullMapping[normFullName] || null;
}

/*******************************************************
 * 11) HÀM PHỤ TRỢ: Map loại đơn nhập liệu thành giá trị chuẩn
 *******************************************************/
function mapLoaiDon(raw) {
  const normalized = stripAccents(raw).toLowerCase().trim();

  // Nếu bắt đầu bằng lấy mới, mua mới, đặt mới → "Lấy 1 lần 100%"
  const pickupKeys = ["lay moi", "mua moi", "dat moi"];
  if (pickupKeys.some(k => normalized.startsWith(k))) {
    return "Lấy 1 lần 100%";
  }

  // Nếu có rut, lo, hang, gui → "Rút lô hàng gửi"
  const withdrawKeys = ["rut lo", "rut hang", "lay lo", "lay lo gui", "giao hang gui", "rut gui", "rut luong", "rut ton"];
  if (withdrawKeys.some(k => normalized.includes(k))) {
    return "Rút lô hàng gửi";
  }

  // Mặc định trả raw (hoặc trả normalized tuỳ nhu cầu)
  return raw.trim();
}

/*******************************************************
 * 12) HÀM PHỤ TRỢ: Chuẩn bị mảng dữ liệu cho dòng mới (20 cột, C..V)
 *******************************************************/
function prepareNewRow(newRowIndex, data, warehouseInfo) {
  const now = new Date();
  const vietnamTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
  const hour = vietnamTime.getHours();

  // (Ví dụ) nếu >= 15h => đẩy sang ngày hôm sau
  if (hour >= 15) {
    vietnamTime.setDate(vietnamTime.getDate() + 1);
  }
  const dateVal = Utilities.formatDate(vietnamTime, "Asia/Ho_Chi_Minh", "dd/MM/yyyy");

  const rawLoaiDon = data['Loại đơn'] || "";
  const loaiDon = mapLoaiDon(rawLoaiDon);

  let ck = 0, ckdc = 0;
  if (loaiDon.trim().toLowerCase() !== "rút lô hàng gửi") {
    const discountCol = getDiscountColumn(data["Loại hàng"]);
    if (warehouseInfo && discountCol && warehouseInfo[discountCol] !== "") {
      ck = parseFloat(warehouseInfo[discountCol].replace(",", ".")) || 0;
    }
  }
  // const soLuong = data['Số lượng'].toString() || 0;
  const soLuong = Number(data['Số lượng']) || 0;
  const bks = data["BKS"] ? "'" + data["BKS"] : "";

  // Chuẩn bị mảng 20 phần tử, ghi vào cột C..V
  return [
    "",             // C (3)
    "",             // D (4) - có thể là giờ
    dateVal,        // E (5) - Ngày
    data["Đơn"],    // F (6)
    "THIÊN PHÚC",   // G (7)
    data["Khách hàng"], // H (8)
    loaiDon,        // I (9)
    1,              // J (10) - STTCT
    data["Loại hàng"], // K (11)
    "C",            // L (12)
    soLuong,        // M (13)
    ck,             // N (14)
    ckdc,           // O (15)
    0,              // P (16)
    "",             // Q (17) - Sẽ set formula sau
    "",             // R (18) - chưa dùng
    data["Kho nhận"], // S (19)
    bks,            // T (20)
    data["Lái xe"], // U (21)
    ""              // V (22) - phân loại
  ];
}

/*******************************************************
 * 13) HÀM PHỤ TRỢ: Lấy discount column dựa trên mã loại hàng
 *******************************************************/
function getDiscountColumn(loaiHang) {
  const code = getFuelTypeCodeFromName(loaiHang);
  return (code === "DO" || code === "DO001" || code === "E5" || code === "E10") ? code : null;
}

/*******************************************************
 * 14) Hàm gửi mail
 *******************************************************/
function sendEmailNotification(userEmail) {
  const recipients = ["sonds@tpoil.vn"];
  const ccRecipients = ["duongna@tpoil.vn", "linhnh@tpoil.vn"];
  const subject = "Thông báo: Thay đổi chiết khấu!";
  const body = `Chiết khấu trong Google Sheets đã được thay đổi.\n\nThao tác được thực hiện bởi: ${userEmail}\n\nTrân trọng!`;
  MailApp.sendEmail({
    to: recipients.join(","),
    cc: ccRecipients.join(","),
    subject: subject,
    body: body
  });
}

/** Helpers */
function normalizeYmd(val) {
  const tz = TZ;
  if (val instanceof Date) {
    return Utilities.formatDate(val, tz, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // dd/MM/yyyy
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  // fallback
  const d = new Date(s);
  if (!isNaN(d)) return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
  return s;
}


function formatNumberVN(n) {
  if (n === '' || n === null || n === undefined) return '';
  const num = typeof n === 'number' ? n : parseFloat(String(n).replace(/,/g, ''));
  if (isNaN(num)) return String(n);
  // Format theo vi-VN (dấu . ngăn cách nghìn, , thập phân)
  return Utilities.formatString('%s', num.toLocaleString('vi-VN'));
}
function buildCopyHtml(orders, dupGroups, dupPeers, kho, dateStr, plainText) {
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Header “Đơn x, y trùng”
  const groupLine = dupGroups.length
    ? dupGroups.map(g => `<b>Đơn ${g.join(', ')}</b> trùng`).join(' &nbsp;•&nbsp; ')
    : '<i>Không có đơn trùng</i>';

  const itemsHtml = orders.map(o => {
    const cls = o.dup ? 'item dup' : 'item';
    const peerTxt = dupPeers.get(o.stt) && dupPeers.get(o.stt).length
      ? `<div class="dupnote"><b>Trùng với: Đơn ${dupPeers.get(o.stt).join(', ')}</b></div>`
      : '';
    return `
      <div class="${cls}">
        <div class="line"><b>Đơn ${o.stt}</b></div>
        <div class="line">BKS: ${esc(o.bks)}</div>
        <div class="line">Lái xe: ${esc(o.laiXe)}</div>
        <div class="line">${esc(o.loaiHang)}: ${esc(o.soLuong)}. kho ${esc(o.kho)}</div>
        ${peerTxt}
      </div>
    `;
  }).join('') || `<div class="empty">(Không có đơn)</div>`;

  const safeText = esc(plainText);

  return `
  <style>
    body { font-family: system-ui, Arial; padding:12px; }
    h3  { margin:0 0 6px; font-size:16px; }
    .meta { color:#666; margin-bottom:6px; }
    .dups { margin:6px 0 10px; }
    .list { max-height:300px; overflow:auto; border:1px solid #eee; padding:8px; border-radius:8px; }
    .item { padding:8px; margin-bottom:8px; border:1px dashed #ddd; border-radius:8px; background:#fff; }
    .item.dup { background:#fff7cc; } /* vàng nhạt khi trùng */
    .line { margin:2px 0; }
    .dupnote { margin-top:4px; }
    .empty { color:#999; font-style:italic; padding:8px; }
    textarea { width:100%; height:120px; margin-top:10px; }
    .row { display:flex; gap:8px; margin-top:8px; }
    button { padding:8px 12px; cursor:pointer; }
  </style>

  <h3>Danh sách đơn – ${esc(kho)}</h3>
  <div class="meta">Ngày: ${esc(dateStr)}</div>
  <div class="dups">${groupLine}</div>

  <div class="list">${itemsHtml}</div>

  <textarea id="ta">${safeText}</textarea>
  <div class="row">
    <button onclick="copyNow()">Copy toàn bộ</button>
    <button onclick="google.script.host.close()">Đóng</button>
  </div>

  <script>
    function copyNow() {
      const t = document.getElementById('ta');
      t.select(); t.setSelectionRange(0, 999999);
      navigator.clipboard.writeText(t.value)
        .then(()=>alert('Đã copy vào clipboard!'))
        .catch(()=>document.execCommand('copy') && alert('Đã copy (fallback).'));
    }
  </script>
  `;
}

/*******************************************************
 * 15) ON EDIT Trigger
 *******************************************************/
function onEditSimplee(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() == "A. NHẬP DHA") {

    const a1 = e.range.getA1Notation();
    // 1) User pasted a full-order block into M1
    if (a1 === "M1" && e.value && e.oldValue === undefined) {
      // Prevent concurrent executions
      const lock = LockService.getScriptLock();
      if (lock.tryLock(3000)) {
        try {
          processNewRow(e);
        } finally {
          lock.releaseLock();
        }
      }
      return;
    }

    const editedCol = e.range.getColumn();
    // 2) If they edit Loại đơn (col I), Loại hàng (col K) or Kho nhận (col S), recalc CK
    if (editedCol === 9 || editedCol === 11 || editedCol === 19) {
      recalcCKForRow(sheet, e.range.getRow());
      return;
    }

    // 3) If they edit Ngày (col E) or Số lượng (col M), check stock
    if (editedCol === 5 || editedCol === 13) {
      if (editedCol === 13 && e.oldValue !== undefined) {
        checkStockForRow(sheet, e.range.getRow(), e.oldValue);
      } else {
        checkStockForRow(sheet, e.range.getRow());
      }
    }
  }
}
