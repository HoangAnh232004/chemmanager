const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const monthly = require('../monthly');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Đổi giá trị ngày trong Excel (số serial hoặc đối tượng Date) sang dạng YYYY-MM-DD
// Chuỗi không phải ngày (vd '1 năm', 'không đặt nữa' ở cột hạn dùng) trả về null
// thay vì đẩy thẳng vào cột DATE gây lỗi cả file
function toDateStr(v) {
  if (v === '' || v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'number') {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10); // đã dạng yyyy-mm-dd
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/); // dạng dd/mm/yyyy (kiểu Việt Nam)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null;
}

// Đổi giá trị giá trong Excel sang số + đơn vị: '6.50 USD/KG' -> { price: 6.5, unit: 'USD/KG' },
// '49,125' -> { price: 49125, unit: '' }, '414,000 VND' -> { price: 414000, unit: 'VND' }.
// Dấu chấm/phẩy phân biệt kiểu Việt Nam: phần cuối 3 chữ số thì là ngăn cách nghìn,
// còn lại là thập phân (nên 6.50 là 6.5 chứ không phải 650 như bản strip chữ cũ).
function toPrice(v) {
  if (v === undefined || v === null || String(v).trim() === '') return { price: null, unit: '' };
  if (typeof v === 'number') return { price: v, unit: '' };
  const s = String(v).trim();
  const m = s.match(/-?[\d.,]+/);
  if (!m) return { price: null, unit: '' };
  let num = m[0];
  const hasDot = num.includes('.'), hasComma = num.includes(',');
  if (hasDot && hasComma) {
    if (num.lastIndexOf('.') > num.lastIndexOf(',')) num = num.replace(/,/g, '');
    else num = num.replace(/\./g, '').replace(',', '.');
  } else if (hasComma) {
    const parts = num.split(',');
    num = parts[parts.length - 1].length === 3 ? num.replace(/,/g, '') : num.replace(',', '.');
  } else if (hasDot) {
    const parts = num.split('.');
    num = parts[parts.length - 1].length === 3 ? num.replace(/\./g, '') : num;
  }
  const price = parseFloat(num);
  // Đơn vị là phần chữ còn lại sau khi bỏ số (vd 'USD/KG', 'VND'), viết hoa cho đều
  const unit = s.replace(m[0], '').replace(/[\s()]/g, '').toUpperCase();
  return { price: Number.isNaN(price) ? null : price, unit };
}

// Tìm bảng dữ liệu trong file Excel: quét mọi sheet, tự tìm hàng tiêu đề
// trong 20 hàng đầu có chứa 1 trong các tên cột cần tìm.
// Trả về { headers, rows } (rows là mảng object, key = tên cột viết hoa),
// hoặc null nếu không tìm thấy hàng tiêu đề nào.
function findTable(wb, nameKeys) {
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const cells = aoa[i].map((c) => String(c).trim().toUpperCase());
      if (cells.some((c) => nameKeys.includes(c))) { headerIdx = i; break; }
    }
    if (headerIdx === -1) continue;
    const headers = aoa[headerIdx].map((c) => String(c).trim().toUpperCase());
    const rows = [];
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const obj = {};
      headers.forEach((h, j) => { obj[h] = aoa[i][j]; });
      rows.push(obj);
    }
    return { headers, rows };
  }
  return null;
}

// Chuẩn hóa tên để đối chiếu: gộp khoảng trắng/xuống dòng thành 1 dấu cách, không phân biệt hoa thường
// (để 'CÔNG TY TNHH \nAEKYUNG...' khớp với 'CÔNG TY TNHH AEKYUNG...')
// So sánh tên: bỏ dấu tiếng Việt, bỏ khoảng trắng và dấu câu, không phân biệt hoa thường
// (vd 'CÔNG TY HOÁ CHẤT A' khớp 'cong ty hoa chat a', 'CO.,LTD' khớp 'CO LTD').
// Dùng chung cho hóa chất và NCC khi nhập file: tên đã có trong danh mục thì dùng luôn
// dòng đó, không tạo dòng trùng nữa. Chỉ dùng để so sánh, tên lưu vào DB vẫn giữ nguyên.
function normName(v) {
  return String(v === undefined || v === null ? '' : v)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/Đ/g, 'D')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Tên lưu vào database: cắt khoảng trắng đầu/cuối, gộp khoảng trắng giữa thành 1 dấu cách
function cleanName(v) {
  return String(v === undefined || v === null ? '' : v).trim().replace(/\s+/g, ' ');
}

// Số trong Excel (bỏ dấu phẩy ngăn cách nghìn); trả null nếu trống hoặc không phải số
function toNum(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/,/g, '').trim());
  return Number.isNaN(n) ? null : n;
}

// Tìm bảng tồn kho kiểu STOCK LIST: quét mọi sheet, tìm hàng tiêu đề (20 hàng đầu)
// có chứa cột CLOSING STOCK (tên cột đã chuẩn hóa: hoa, gộp khoảng trắng/xuống dòng).
// Trả về mảng dòng đã chuẩn hóa, hoặc null nếu không có sheet nào khớp.
function findStockListTable(wb) {
  const normHeader = (c) => String(c === undefined || c === null ? '' : c).toUpperCase().replace(/\s+/g, ' ').trim();
  const ORDER_KEYS = ['발주수량/회', 'ORDER QTY', 'ORDER_QTY'];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let headerIdx = -1;
    for (let i = 0; i < Math.min(aoa.length, 20); i++) {
      const cells = aoa[i].map(normHeader);
      if (cells.includes('CLOSING STOCK') || cells.includes('CLOSING')) { headerIdx = i; break; }
    }
    if (headerIdx === -1) continue;
    const headers = aoa[headerIdx].map(normHeader);
    const colOf = (...names) => { for (const n of names) { const j = headers.indexOf(n); if (j !== -1) return j; } return -1; };
    let itemCol = headers.indexOf('ITEM');
    if (itemCol === -1) itemCol = headers.indexOf('VIETNAMESE');
    if (itemCol === -1) continue;
    const supplierCol = colOf('SUPPLIER');
    const expiryCol = colOf('EXPIRY DATE', 'EXPIRY');
    const minCol = colOf('MINIMUM STOCK', 'MIN STOCK');
    const packCol = colOf('PACKAGING SIZE', 'PACKAGING');
    const stockInCol = colOf('STOCK IN');
    const closingCol = colOf('CLOSING STOCK', 'CLOSING');
    let orderCol = -1;
    headers.forEach((h, j) => { if (ORDER_KEYS.includes(h)) orderCol = j; });
    if (closingCol === -1) continue;
    // Bỏ qua hàng tiêu đề phụ (VIETNAMESE/KOREAN) ngay sau hàng tiêu đề chính
    let dataStart = headerIdx + 1;
    if (dataStart < aoa.length && aoa[dataStart].map(normHeader).includes('VIETNAMESE')) dataStart++;
    const rows = [];
    for (let i = dataStart; i < aoa.length; i++) {
      const r = aoa[i];
      rows.push({
        chemical_name: r[itemCol],
        korean_name: r[itemCol + 1],
        supplier_name: supplierCol === -1 ? '' : r[supplierCol],
        expiry_date: expiryCol === -1 ? '' : r[expiryCol],
        min_stock: minCol === -1 ? '' : r[minCol],
        order_qty: orderCol === -1 ? '' : r[orderCol],
        packaging: packCol === -1 ? '' : r[packCol],
        stock_in: stockInCol === -1 ? '' : r[stockInCol],
        closing: closingCol === -1 ? '' : r[closingCol],
      });
    }
    return rows;
  }
  return null;
}

// Tải file Excel mẫu (không cần đăng nhập)
router.get('/template', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { 'Tên': 'Acid Sulfuric', 'Loại': 'acid', 'Grade': 'AR', 'Tiêu chuẩn': 'TCVN 123', 'Nhóm nguy hiểm': 'Ăn mòn', 'Điều kiện lưu trữ': 'Nơi khô ráo' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'DanhMuc');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="mau_danh_muc.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Nhập hóa chất từ Excel: cột nào khớp thì lấy, cột nào không có thì để trống
// Ném file tồn kho kiểu STOCK LIST vào đây cũng được: chỉ lấy thông tin hóa chất
// (tên, tên Hàn, quy cách, tồn tối thiểu, số lượng đặt hàng), không động vào kho hay NCC
// Chỉ admin mới được nhập
router.post('/chemicals', verifyToken, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn file' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    // Dạng file tồn kho kiểu STOCK LIST: chỉ thêm/cập nhật hóa chất
    const stockRowsChem = findStockListTable(wb);
    if (stockRowsChem) {
      const [chemRows] = await pool.query('SELECT * FROM chemicals');
      const chemByNorm = new Map();
      chemRows.forEach((c) => chemByNorm.set(normName(c.name), c));
      const BLOCKED_NAMES = ['TOTAL', 'TONG', 'TONGCONG'];
      let inserted = 0, updated = 0, skipped = 0;
      const errors = [];
      for (const row of stockRowsChem) {
        try {
          const chemName = cleanName(row.chemical_name);
          if (!chemName || BLOCKED_NAMES.includes(normName(chemName))) { skipped++; continue; }
          const korean = cleanName(row.korean_name);
          const packaging = cleanName(row.packaging);
          const minStock = toNum(row.min_stock);
          const orderQty = toNum(row.order_qty);
          const chem = chemByNorm.get(normName(chemName));
          if (!chem) {
            const [r] = await pool.query(
              'INSERT INTO chemicals (name, korean_name, packaging, min_stock, order_qty) VALUES (?, ?, ?, ?, ?)',
              [chemName, korean || null, packaging || null, minStock, orderQty]
            );
            chemByNorm.set(normName(chemName), { id: r.insertId, korean_name: korean || null, packaging: packaging || null, min_stock: minStock, order_qty: orderQty });
            inserted++;
          } else {
            const newKorean = korean || chem.korean_name || null;
            const newPack = packaging || chem.packaging || null;
            const newMin = minStock !== null ? minStock : (chem.min_stock !== null ? Number(chem.min_stock) : null);
            const newOrder = orderQty !== null ? orderQty : (chem.order_qty !== null ? Number(chem.order_qty) : null);
            await pool.query('UPDATE chemicals SET korean_name = ?, packaging = ?, min_stock = ?, order_qty = ? WHERE id = ?', [newKorean, newPack, newMin, newOrder, chem.id]);
            chem.korean_name = newKorean; chem.packaging = newPack; chem.min_stock = newMin; chem.order_qty = newOrder;
            updated++;
          }
        } catch (rowErr) {
          console.error('Lỗi dòng hóa chất:', row.chemical_name, rowErr);
          errors.push(cleanName(row.chemical_name) || '(không tên)');
        }
      }
      req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
      let msg = `Đã nhập ${inserted} hóa chất mới, cập nhật ${updated} hóa chất`;
      if (skipped) msg += `, bỏ qua ${skipped} dòng trống`;
      if (errors.length) msg += `, lỗi ${errors.length} dòng (${errors.slice(0, 5).join(', ')}${errors.length > 5 ? ', ...' : ''})`;
      return res.json({ message: msg, inserted, updated });
    }
    const table = findTable(wb, ['TÊN', 'TEN', 'NAME', 'TÊN HÓA CHẤT', 'TEN HOA CHAT']);
    if (!table) {
      return res.json({ message: 'Đã nhập 0 dòng. Không tìm thấy hàng tiêu đề có cột Tên trong file.', inserted: 0 });
    }

    const map = {
      'TÊN': 'name', 'TEN': 'name', 'NAME': 'name', 'TÊN HÓA CHẤT': 'name', 'TEN HOA CHAT': 'name',
      'LOẠI': 'type', 'LOAI': 'type', 'TYPE': 'type',
      'GRADE': 'grade',
      'TIÊU CHUẨN': 'standard', 'TIEU CHUAN': 'standard', 'STANDARD': 'standard',
      'NHÓM NGUY HIỂM': 'hazard_group', 'NHOM NGUY HIEM': 'hazard_group', 'HAZARD_GROUP': 'hazard_group',
      'ĐIỀU KIỆN LƯU TRỮ': 'storage_condition', 'DIEU KIEN LUU TRU': 'storage_condition', 'STORAGE_CONDITION': 'storage_condition',
    };

    let inserted = 0;
    for (const row of table.rows) {
      const data = {};
      for (const key of Object.keys(row)) {
        const field = map[key];
        const v = row[key];
        if (field && v !== undefined && v !== null && String(v).trim() !== '') data[field] = String(v).trim();
      }
      if (!data.name) continue; // bỏ qua dòng trống hoặc không có tên
      await pool.query(
        'INSERT INTO chemicals (name, type, grade, standard, hazard_group, storage_condition) VALUES (?, ?, ?, ?, ?, ?)',
        [data.name, data.type || null, data.grade || null, data.standard || null, data.hazard_group || null, data.storage_condition || null]
      );
      inserted++;
    }

    req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
    res.json({ message: `Đã nhập ${inserted} dòng${inserted === 0 ? ` (các cột đọc được: ${table.headers.filter((h) => h).join(', ')})` : ''}`, inserted });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: 'File không đọc được, kiểm tra lại định dạng' });
  }
});

// File mẫu nhà cung cấp (chỉ có STT và TEN NL)
router.get('/template/suppliers', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { 'STT': 1, 'TEN NL': 'SB-100 (nhựa)=nhựa AK' },
    { 'STT': 2, 'TEN NL': 'RB-110 (T4-1) (NHỰA HORN NL2)' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'NhaCungCap');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="mau_nha_cung_cap.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// File mẫu kho
router.get('/template/inventory', (req, res) => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet([
    { 'Mã lot': 'LOT001', 'Tên hóa chất': 'Acid Sulfuric', 'Nhà cung cấp': 'Công ty TNHH Hóa chất ABC', 'Số lượng': 100, 'Đơn vị': 'kg', 'Độ tinh khiết': '98%', 'Hạn sử dụng': '2027-12-31', 'Ngày nhập': '2026-10-26', 'Vị trí kho': 'Kệ A1' },
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Kho');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('Content-Disposition', 'attachment; filename="mau_kho.xlsx"');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(buf);
});

// Nhập nhà cung cấp từ Excel: cột nào khớp thì lấy, cột nào không có thì để trống
// Nhận cả file 6 cột (TÊN HÓA CHẤT | NHÀ CUNG CẤP | TÊN NGƯỜI LIÊN HỆ | SỐ LIÊN HỆ | GIÁ | MAIL)
// và file cũ dạng STT | TEN NL
// Ném file tồn kho kiểu STOCK LIST vào đây cũng được: chỉ lấy tên NCC trong file,
// không động vào hóa chất hay kho
// Chỉ admin mới được nhập
router.post('/suppliers', verifyToken, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn file' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    // Dạng file tồn kho kiểu STOCK LIST: chỉ thêm NCC chưa có (tên only, các trường khác để trống)
    const stockRowsSup = findStockListTable(wb);
    if (stockRowsSup) {
      const [supRows] = await pool.query('SELECT id, name FROM suppliers');
      const supByNorm = new Map();
      supRows.forEach((s) => supByNorm.set(normName(s.name), s));
      const seen = new Set();
      let inserted = 0, existed = 0;
      for (const row of stockRowsSup) {
        const supName = cleanName(row.supplier_name);
        if (!supName) continue;
        const norm = normName(supName);
        if (seen.has(norm)) continue;
        seen.add(norm);
        if (supByNorm.has(norm)) { existed++; continue; }
        const [r] = await pool.query('INSERT INTO suppliers (name) VALUES (?)', [supName]);
        supByNorm.set(norm, { id: r.insertId });
        inserted++;
      }
      req.app.get('io')?.emit('data_changed', { table: 'suppliers' });
      return res.json({ message: `Đã nhập ${inserted} nhà cung cấp mới${existed ? `, ${existed} nhà cung cấp đã có sẵn nên bỏ qua` : ''}`, inserted });
    }
    const table = findTable(wb, ['NHÀ CUNG CẤP', 'NHA CUNG CAP', 'TEN NL', 'TÊN NL', 'TÊN', 'TEN', 'NAME', 'TÊN NCC', 'TEN NCC']);
    if (!table) {
      return res.json({ message: 'Đã nhập 0 dòng. Không tìm thấy hàng tiêu đề có cột nhà cung cấp trong file.', inserted: 0 });
    }

    const map = {
      'NHÀ CUNG CẤP': 'name', 'NHA CUNG CAP': 'name', 'SUPPLIER_NAME': 'name',
      'TÊN NCC': 'name', 'TEN NCC': 'name',
      'TEN NL': 'name', 'TÊN NL': 'name',
      'TÊN': 'name', 'TEN': 'name', 'NAME': 'name',
      'TÊN HÓA CHẤT': 'chemical_name', 'TEN HOA CHAT': 'chemical_name', 'CHEMICAL_NAME': 'chemical_name',
      'TÊN NGƯỜI LIÊN HỆ': 'contact', 'TEN NGUOI LIEN HE': 'contact',
      'LIÊN HỆ': 'contact', 'LIEN HE': 'contact', 'CONTACT': 'contact',
      'SỐ LIÊN HỆ': 'phone', 'SO LIEN HE': 'phone',
      'SĐT': 'phone', 'SDT': 'phone',
      'ĐIỆN THOẠI': 'phone', 'DIEN THOAI': 'phone', 'PHONE': 'phone',
      'GIÁ': 'price', 'GIA': 'price', 'PRICE': 'price',
      'MAIL': 'email', 'EMAIL': 'email',
    };

    let inserted = 0;
    for (const row of table.rows) {
      const data = {};
      for (const key of Object.keys(row)) {
        const field = map[key];
        const v = row[key];
        if (field && v !== undefined && v !== null && String(v).trim() !== '') data[field] = v;
      }
      if (data.name === undefined || data.name === null || String(data.name).trim() === '') continue;
      const parsedPrice = toPrice(data.price);
      await pool.query(
        'INSERT INTO suppliers (name, chemical_name, contact, phone, price, price_unit, email) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [String(data.name).trim(), data.chemical_name ? String(data.chemical_name).trim() : null, data.contact ? String(data.contact).trim() : null, data.phone ? String(data.phone).trim() : null, parsedPrice.price, parsedPrice.unit || null, data.email ? String(data.email).trim() : null]
      );
      inserted++;
    }

    req.app.get('io')?.emit('data_changed', { table: 'suppliers' });
    res.json({ message: `Đã nhập ${inserted} dòng${inserted === 0 ? ` (các cột đọc được: ${table.headers.filter((h) => h).join(', ')})` : ''}`, inserted });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: 'File không đọc được, kiểm tra lại định dạng' });
  }
});

// Nhập kho từ Excel (chỉ admin):
//  - File tồn kho kiểu STOCK LIST (1 dòng = 1 hóa chất, có cột CLOSING STOCK):
//    mỗi dòng tạo/cập nhật 1 lot mã KHO-<tên hóa chất>, số lượng lot = STOCK IN,
//    tồn khả dụng = CLOSING STOCK. Hóa chất/NCC chưa có trong danh mục thì tự tạo luôn
//    từ dữ liệu trong file, nhưng trước khi tạo sẽ so sánh tên với danh mục sẵn có
//    (không phân biệt hoa thường/khoảng trắng/xuống dòng): tên đã có thì dùng luôn dòng đó,
//    không tạo trùng, không ghi đè thông tin chi tiết; tên chưa có mới tạo mới.
//    Nhập lại file tháng sau sẽ cập nhật đúng các lot đó, không tạo trùng.
//  - File lot kiểu cũ (có cột Mã lot): mỗi dòng tạo 1 lot + tồn kho + phiếu QC chờ kiểm
//    (hóa chất/NCC cũng so sánh tên rồi mới tạo như trên)
router.post('/inventory', verifyToken, requireAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Chưa chọn file' });
  try {
    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    // Dạng 1: file tồn kho kiểu STOCK LIST
    const stockRows = findStockListTable(wb);
    if (stockRows) {
      // Kỳ kho tháng chốt trước khi ghi (sang tháng mới thì file này thuộc tháng mới)
      let openPeriod = null;
      try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
      // So sánh tên với danh mục sẵn có trước khi tạo: tên đã có thì dùng luôn, chưa có mới tạo.
      // Đối chiếu theo tên đã chuẩn hóa để tên lệch khoảng trắng/xuống dòng vẫn khớp
      const [chemRows] = await pool.query('SELECT * FROM chemicals');
      const chemByNorm = new Map();
      chemRows.forEach((c) => chemByNorm.set(normName(c.name), c));
      const [supRows] = await pool.query('SELECT id, name FROM suppliers');
      const supByNorm = new Map();
      supRows.forEach((s) => supByNorm.set(normName(s.name), s));

      const BLOCKED_NAMES = ['TOTAL', 'TONG', 'TONGCONG'];
      let inserted = 0, updated = 0, skipped = 0, chemCreated = 0, supCreated = 0;
      const errors = [];
      for (const row of stockRows) {
        try {
          const chemName = cleanName(row.chemical_name);
          if (!chemName || BLOCKED_NAMES.includes(normName(chemName))) { skipped++; continue; }
          const norm = normName(chemName);
          const korean = cleanName(row.korean_name);
          const packaging = cleanName(row.packaging);
          const minStock = toNum(row.min_stock);
          const orderQty = toNum(row.order_qty);

          let chem = chemByNorm.get(norm);
          if (!chem) {
            const [r] = await pool.query(
              'INSERT INTO chemicals (name, korean_name, packaging, min_stock, order_qty) VALUES (?, ?, ?, ?, ?)',
              [chemName, korean || null, packaging || null, minStock, orderQty]
            );
            chem = { id: r.insertId, korean_name: korean || null, packaging: packaging || null, min_stock: minStock, order_qty: orderQty };
            chemByNorm.set(norm, chem);
            chemCreated++;
          } else {
            const newKorean = korean || chem.korean_name || null;
            const newPack = packaging || chem.packaging || null;
            const newMin = minStock !== null ? minStock : (chem.min_stock !== null ? Number(chem.min_stock) : null);
            const newOrder = orderQty !== null ? orderQty : (chem.order_qty !== null ? Number(chem.order_qty) : null);
            await pool.query('UPDATE chemicals SET korean_name = ?, packaging = ?, min_stock = ?, order_qty = ? WHERE id = ?', [newKorean, newPack, newMin, newOrder, chem.id]);
            chem.korean_name = newKorean; chem.packaging = newPack; chem.min_stock = newMin; chem.order_qty = newOrder;
          }

          // So sánh tên NCC với danh mục: có rồi thì dùng luôn (không tạo trùng),
          // chưa có mới tạo thêm (chỉ có tên, muốn đủ thông tin thì nhập file NCC sau)
          let supplier_id = null;
          const supName = cleanName(row.supplier_name);
          if (supName) {
            let sup = supByNorm.get(normName(supName));
            if (!sup) {
              const [r] = await pool.query('INSERT INTO suppliers (name) VALUES (?)', [supName]);
              sup = { id: r.insertId };
              supByNorm.set(normName(supName), sup);
              supCreated++;
            }
            supplier_id = sup.id;
          }

          const stockIn = toNum(row.stock_in) ?? 0;
          let closing = toNum(row.closing);
          if (closing === null) closing = stockIn;
          const expiry = toDateStr(row.expiry_date);
          const lot_code = 'KHO-' + chemName;

          const [[existingLot]] = await pool.query('SELECT id, DATE_FORMAT(expiry_date, "%Y-%m-%d") AS expiry_date FROM lots WHERE lot_code = ?', [lot_code]);
          if (existingLot) {
            const newExpiry = expiry !== null ? expiry : existingLot.expiry_date;
            await pool.query('UPDATE lots SET chemical_id = ?, supplier_id = ?, quantity = ?, expiry_date = ? WHERE id = ?', [chem.id, supplier_id, stockIn, newExpiry, existingLot.id]);
            const [[inv]] = await pool.query('SELECT id FROM inventory WHERE lot_id = ?', [existingLot.id]);
            if (inv) await pool.query('UPDATE inventory SET quantity_available = ? WHERE id = ?', [closing, inv.id]);
            else await pool.query('INSERT INTO inventory (lot_id, quantity_available) VALUES (?, ?)', [existingLot.id, closing]);
            updated++;
          } else {
            const [result] = await pool.query(
              'INSERT INTO lots (lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "excel")',
              [lot_code, chem.id, supplier_id, stockIn, 'kg', null, expiry, null]
            );
            const lotId = result.insertId;
            await pool.query('INSERT INTO inventory (lot_id, quantity_available) VALUES (?, ?)', [lotId, closing]);
            await pool.query('INSERT INTO qc_tests (lot_id, status) VALUES (?, "quarantine")', [lotId]);
            await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note) VALUES (?, "import", ?, "Nhập tồn kho từ Excel")', [lotId, stockIn]);
            inserted++;
          }
          // Kho tháng: Nhập Excel của tháng = đúng STOCK IN trong file (ghi đè, nhập lại vẫn đúng)
          if (openPeriod) {
            try {
              await monthly.setImportRow(openPeriod.id, chemName, stockIn, {
                chemical_id: chem.id, korean_name: chem.korean_name || null,
                supplier_name: supName || null, packaging: chem.packaging || null,
                min_stock: chem.min_stock, order_qty: chem.order_qty,
              });
            } catch (me) { console.error('Lỗi ghi kho tháng:', me); }
          }
        } catch (rowErr) {
          console.error('Lỗi dòng tồn kho:', row.chemical_name, rowErr);
          errors.push(cleanName(row.chemical_name) || '(không tên)');
        }
      }

      req.app.get('io')?.emit('data_changed', { table: 'inventory' });
      req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
      req.app.get('io')?.emit('data_changed', { table: 'suppliers' });
      let msg = `Đã nhập ${inserted} dòng mới, cập nhật ${updated} dòng`;
      if (skipped) msg += `, bỏ qua ${skipped} dòng trống`;
      if (chemCreated) msg += `, tạo thêm ${chemCreated} hóa chất`;
      if (supCreated) msg += `, tạo thêm ${supCreated} NCC`;
      if (errors.length) msg += `, lỗi ${errors.length} dòng (${errors.slice(0, 5).join(', ')}${errors.length > 5 ? ', ...' : ''})`;
      return res.json({ message: msg, inserted, updated });
    }
    // Dạng 2: file lot kiểu cũ
    const table = findTable(wb, ['MÃ LOT', 'MA LOT', 'LOT_CODE', 'TÊN HÓA CHẤT', 'TEN HOA CHAT', 'TÊN', 'TEN']);
    if (!table) {
      return res.json({ message: 'Đã nhập 0 dòng. Không tìm thấy hàng tiêu đề có cột Mã lot hoặc Tên hóa chất trong file.', inserted: 0 });
    }

    const map = {
      'MÃ LOT': 'lot_code', 'MA LOT': 'lot_code', 'LOT_CODE': 'lot_code',
      'TÊN HÓA CHẤT': 'chemical_name', 'TEN HOA CHAT': 'chemical_name', 'CHEMICAL_NAME': 'chemical_name', 'TÊN': 'chemical_name', 'TEN': 'chemical_name',
      'NHÀ CUNG CẤP': 'supplier_name', 'NHA CUNG CAP': 'supplier_name', 'SUPPLIER_NAME': 'supplier_name', 'NCC': 'supplier_name',
      'SỐ LƯỢNG': 'quantity', 'SO LUONG': 'quantity', 'QUANTITY': 'quantity', 'SL': 'quantity',
      'ĐƠN VỊ': 'unit', 'DON VI': 'unit', 'UNIT': 'unit',
      'ĐỘ TINH KHIẾT': 'purity', 'DO TINH KHIET': 'purity', 'PURITY': 'purity',
      'HẠN SỬ DỤNG': 'expiry_date', 'HAN SU DUNG': 'expiry_date', 'EXPIRY_DATE': 'expiry_date', 'HẠN DÙNG': 'expiry_date', 'HAN DUNG': 'expiry_date',
      'NGÀY NHẬP': 'received_date', 'NGAY NHAP': 'received_date', 'RECEIVED_DATE': 'received_date',
      'VỊ TRÍ KHO': 'location', 'VI TRI KHO': 'location', 'LOCATION': 'location', 'VỊ TRÍ': 'location', 'VI TRI': 'location',
    };

    // Đối chiếu tên đã chuẩn hóa (so sánh tên trước: có rồi thì dùng luôn, chưa có mới tạo)
    const [lotChemRows] = await pool.query('SELECT id, name FROM chemicals');
    const lotChemByNorm = new Map();
    lotChemRows.forEach((c) => lotChemByNorm.set(normName(c.name), c));
    const [lotSupRows] = await pool.query('SELECT id, name FROM suppliers');
    const lotSupByNorm = new Map();
    lotSupRows.forEach((s) => lotSupByNorm.set(normName(s.name), s));

    // Kỳ kho tháng chốt trước khi ghi (sang tháng mới thì file này thuộc tháng mới)
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    let inserted = 0, skipped = 0;
    for (const row of table.rows) {
      // Bỏ qua hàng trống hoàn toàn, không tính vào số dòng bỏ qua
      const values = Object.values(row);
      if (values.every((v) => v === undefined || v === null || String(v).trim() === '')) continue;

      const data = {};
      for (const key of Object.keys(row)) {
        const field = map[key];
        if (field) data[field] = row[key];
      }
      if (!data.lot_code || !data.chemical_name) { skipped++; continue; }

      const lot_code = String(data.lot_code).trim();
      const chemical_name = String(data.chemical_name).trim();

      // Bỏ qua mã lot đã tồn tại
      const [[exists]] = await pool.query('SELECT id FROM lots WHERE lot_code = ?', [lot_code]);
      if (exists) { skipped++; continue; }

      // Tìm hoặc tạo hóa chất (tải lên thôi, thiếu thì tự tạo; đối chiếu tên đã chuẩn hóa)
      let chem = lotChemByNorm.get(normName(chemical_name));
      let chemical_id;
      if (chem) chemical_id = chem.id;
      else {
        const [r] = await pool.query('INSERT INTO chemicals (name) VALUES (?)', [cleanName(chemical_name)]);
        chemical_id = r.insertId;
        lotChemByNorm.set(normName(chemical_name), { id: chemical_id });
      }

      // So sánh tên NCC với danh mục: có rồi thì dùng luôn (không tạo trùng), chưa có mới tạo
      let supplier_id = null;
      if (data.supplier_name) {
        const supplier_name = cleanName(data.supplier_name);
        let sup = lotSupByNorm.get(normName(supplier_name));
        if (!sup) {
          const [r] = await pool.query('INSERT INTO suppliers (name) VALUES (?)', [supplier_name]);
          sup = { id: r.insertId };
          lotSupByNorm.set(normName(supplier_name), sup);
        }
        supplier_id = sup.id;
      }

      const quantity = Number(data.quantity) || 0;
      const [result] = await pool.query(
        'INSERT INTO lots (lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "excel")',
        [lot_code, chemical_id, supplier_id, quantity, data.unit ? String(data.unit).trim() : 'kg', data.purity ? String(data.purity).trim() : null, toDateStr(data.expiry_date), toDateStr(data.received_date)]
      );
      const lotId = result.insertId;
      await pool.query('INSERT INTO inventory (lot_id, location, quantity_available) VALUES (?, ?, ?)', [lotId, data.location ? String(data.location).trim() : null, quantity]);
      await pool.query('INSERT INTO qc_tests (lot_id, status) VALUES (?, "quarantine")', [lotId]);
      await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note) VALUES (?, "import", ?, "Nhập kho từ Excel")', [lotId, quantity]);
      inserted++;
      // Kho tháng: lot mới từ file cộng vào Nhập Excel của kỳ đang mở
      if (openPeriod) {
        try { await monthly.adjustRow(openPeriod.id, chemical_name, { excelIn: quantity }); }
        catch (me) { console.error('Lỗi ghi kho tháng:', me); }
      }
    }

    req.app.get('io')?.emit('data_changed', { table: 'inventory' });
    res.json({ message: `Đã nhập ${inserted} dòng${skipped ? `, bỏ qua ${skipped} dòng (thiếu thông tin hoặc trùng mã lot)` : ''}${inserted === 0 ? ` (các cột đọc được: ${table.headers.filter((h) => h).join(', ')})` : ''}`, inserted });
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: 'File không đọc được, kiểm tra lại định dạng' });
  }
});
// Xóa tất cả hóa chất (chỉ admin)
router.delete('/chemicals', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM chemicals');
    req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
    res.json({ message: `Đã xóa ${result.affectedRows} hóa chất` });
  } catch (e) {
    if (e.errno === 1451) {
      return res.status(400).json({ message: 'Không xóa được vì còn lot đang dùng hóa chất. Hãy xóa hết kho trước rồi xóa lại.' });
    }
    console.error(e);
    res.status(500).json({ message: 'Xóa thất bại' });
  }
});

// Xóa tất cả nhà cung cấp (chỉ admin)
router.delete('/suppliers', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM suppliers');
    req.app.get('io')?.emit('data_changed', { table: 'suppliers' });
    res.json({ message: `Đã xóa ${result.affectedRows} nhà cung cấp` });
  } catch (e) {
    if (e.errno === 1451) {
      return res.status(400).json({ message: 'Không xóa được vì còn lot đang dùng nhà cung cấp. Hãy xóa hết kho trước rồi xóa lại.' });
    }
    console.error(e);
    res.status(500).json({ message: 'Xóa thất bại' });
  }
});

// Xóa tất cả kho: xóa sales trước, rồi xóa lots (tự kéo theo tồn kho, phiếu QC và lịch sử di chuyển)
// Chỉ admin
router.delete('/inventory', verifyToken, requireAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM sales');
    const [result] = await pool.query('DELETE FROM lots');
    // Kho tháng: xóa luôn các dòng của kỳ đang mở (các tháng đã chốt giữ nguyên)
    try { await monthly.clearOpenPeriodRows(); } catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    req.app.get('io')?.emit('data_changed', { table: 'inventory' });
    res.json({ message: `Đã xóa ${result.affectedRows} lot (kèm tồn kho, phiếu QC và lịch sử di chuyển)` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Xóa thất bại' });
  }
});


module.exports = router;
