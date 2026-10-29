// Quản lý kho theo tháng: mỗi tháng là 1 kỳ (period dạng 'YYYY-MM').
// - Kỳ đang mở: Nhập/Xuất cộng dồn từ các thao tác trong tháng, Tồn cuối = tồn thực tế (tính live từ inventory nên luôn khớp kho thật).
// - Khi sang tháng mới: kỳ cũ tự đóng lại (đóng băng số liệu, không sửa được nữa),
//   kỳ mới mở ra với tồn đầu kỳ = tồn cuối kỳ cũ, Nhập/Xuất về 0.
// - Tháng đã đóng là bất biến: mọi hook chỉ chạm vào kỳ đang mở; thao tác thuộc tháng cũ thì bỏ qua.
const { pool } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
function periodOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; }
function currentPeriod() { return periodOf(new Date()); }
function nextPeriod(p) {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  d.setMonth(d.getMonth() + 1);
  return periodOf(d);
}
function labelOf(p) {
  const [y, m] = p.split('-');
  return `Tháng ${Number(m)}/${y}`;
}
const num = (v) => Number(v) || 0;

// Tồn thực tế + NCC mới nhất + hạn dùng gần nhất của từng hóa chất (tính từ lots + inventory)
async function getLiveTotals() {
  const [lots] = await pool.query(`
    SELECT l.id, l.chemical_id, c.name AS chemical_name, s.name AS supplier_name, l.expiry_date
    FROM lots l
    LEFT JOIN chemicals c ON c.id = l.chemical_id
    LEFT JOIN suppliers s ON s.id = l.supplier_id
    ORDER BY l.id DESC
  `);
  const [inv] = await pool.query(`SELECT lot_id, quantity_available FROM inventory`);
  const availByLot = new Map();
  inv.forEach((i) => availByLot.set(i.lot_id, num(i.quantity_available)));
  const map = new Map();
  lots.forEach((l) => {
    if (!l.chemical_name) return;
    if (!map.has(l.chemical_name)) {
      map.set(l.chemical_name, { chemical_id: l.chemical_id, chemical_name: l.chemical_name, total: 0, supplier_name: '', expiry_date: null });
    }
    const r = map.get(l.chemical_name);
    r.total += availByLot.get(l.id) || 0;
    if (!r.supplier_name && l.supplier_name) r.supplier_name = l.supplier_name;
    if (l.expiry_date && (!r.expiry_date || l.expiry_date < r.expiry_date)) r.expiry_date = l.expiry_date;
  });
  return map;
}

async function getOpenPeriod() {
  const [rows] = await pool.query(`SELECT * FROM monthly_periods WHERE status = 'open' ORDER BY period DESC LIMIT 1`);
  return rows[0] || null;
}

// Đóng 1 kỳ: đóng băng tồn cuối + hạn dùng + NCC tại thời điểm đóng, rồi mở kỳ tiếp theo
// với tồn đầu kỳ = tồn cuối kỳ vừa đóng, Nhập/Xuất = 0.
async function closePeriod(periodRow) {
  const live = await getLiveTotals();
  const [rows] = await pool.query(`SELECT * FROM monthly_rows WHERE period_id = ?`, [periodRow.id]);
  const have = new Set();
  for (const r of rows) {
    have.add(r.chemical_name);
    const lv = live.get(r.chemical_name);
    await pool.query(
      `UPDATE monthly_rows SET closing_stock = ?, expiry_date = ?, supplier_name = ? WHERE id = ?`,
      [lv ? lv.total : 0, lv ? lv.expiry_date : null, lv && lv.supplier_name ? lv.supplier_name : r.supplier_name, r.id]
    );
  }
  // Hóa chất có tồn thực tế nhưng chưa có dòng trong kỳ (lọt sổ do tạo trước tính năng tháng):
  // thêm dòng đóng băng để kỳ mới vẫn thừa hưởng đúng tồn
  for (const [name, lv] of live) {
    if (have.has(name)) continue;
    await pool.query(
      `INSERT INTO monthly_rows (period_id, chemical_id, chemical_name, supplier_name, expiry_date, opening_stock, manual_in, excel_in, stock_out, closing_stock)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, ?)`,
      [periodRow.id, lv.chemical_id, name, lv.supplier_name || null, lv.expiry_date, lv.total]
    );
  }
  await pool.query(`UPDATE monthly_periods SET status = 'closed', closed_at = NOW() WHERE id = ?`, [periodRow.id]);
  // Mở kỳ tiếp theo, thừa hưởng tồn cuối
  const np = nextPeriod(periodRow.period);
  let newId;
  try {
    const [ins] = await pool.query(`INSERT INTO monthly_periods (period, status) VALUES (?, 'open')`, [np]);
    newId = ins.insertId;
  } catch (e) {
    if (e.errno !== 1062) throw e; // 1062 = kỳ tháng sau đã có người tạo trước (đóng trùng), dùng luôn
    const [ex] = await pool.query(`SELECT * FROM monthly_periods WHERE period = ?`, [np]);
    return ex[0];
  }
  const [closedRows] = await pool.query(`SELECT * FROM monthly_rows WHERE period_id = ?`, [periodRow.id]);
  const [chems] = await pool.query(`SELECT * FROM chemicals`);
  const chemByName = new Map(chems.map((c) => [c.name, c]));
  for (const r of closedRows) {
    const info = chemByName.get(r.chemical_name) || {};
    await pool.query(
      `INSERT INTO monthly_rows (period_id, chemical_id, chemical_name, korean_name, supplier_name, packaging, min_stock, order_qty, opening_stock, manual_in, excel_in, stock_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`,
      [newId, r.chemical_id, r.chemical_name, info.korean_name || r.korean_name || null, r.supplier_name || null, info.packaging || r.packaging || null, info.min_stock != null ? info.min_stock : r.min_stock, info.order_qty != null ? info.order_qty : r.order_qty, r.closing_stock]
    );
  }
  const [npRow] = await pool.query(`SELECT * FROM monthly_periods WHERE id = ?`, [newId]);
  return npRow[0];
}

// Đảm bảo luôn có kỳ đang mở là kỳ hiện tại: chưa có kỳ nào thì tạo kỳ tháng này
// (khởi tạo tồn đầu kỳ = tồn thực tế hiện tại); kỳ đang mở đã qua tháng thì đóng lại
// và mở kỳ tháng này (đóng nhiều tháng liên tiếp nếu web lâu không mở).
async function ensureCurrentPeriod() {
  let open = await getOpenPeriod();
  if (!open) {
    const p = currentPeriod();
    let created = false;
    try {
      const [ins] = await pool.query(`INSERT INTO monthly_periods (period, status) VALUES (?, 'open')`, [p]);
      open = { id: ins.insertId, period: p, status: 'open' };
      created = true;
    } catch (e) {
      if (e.errno !== 1062) throw e; // 1062 = trùng kỳ do 2 request cùng tạo, lấy lại kỳ đã có
      open = await getOpenPeriod();
    }
    // Khởi tạo lần đầu: tồn đầu kỳ = tồn thực tế hiện tại (dữ liệu trước tính năng tháng
    // không tách được Nhập/Xuất theo tháng nên tháng đầu tiên bắt đầu từ tồn hiện tại)
    if (created) {
      const live = await getLiveTotals();
      const [chems] = await pool.query(`SELECT * FROM chemicals`);
      const chemByName = new Map(chems.map((c) => [c.name, c]));
      for (const [name, lv] of live) {
        const info = chemByName.get(name) || {};
        await pool.query(
          `INSERT INTO monthly_rows (period_id, chemical_id, chemical_name, korean_name, supplier_name, packaging, min_stock, order_qty, opening_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [open.id, lv.chemical_id, name, info.korean_name || null, lv.supplier_name || null, info.packaging || null, info.min_stock || 0, info.order_qty || 0, lv.total]
        );
      }
    }
  }
  const cur = currentPeriod();
  while (open.period < cur) {
    open = await closePeriod(open);
  }
  return open;
}

// Chốt tháng thủ công (admin): đóng kỳ đang mở ngay, mở luôn kỳ tháng tiếp theo
// (kể cả khi hôm nay vẫn còn trong tháng cũ).
async function closeCurrentAndOpenNext() {
  const open = await ensureCurrentPeriod();
  return closePeriod(open);
}

// Chỉ ghi đè các trường thông tin khi có giá trị (file Excel trống ô nào thì giữ giá trị cũ)
function infoSets(info) {
  const sets = []; const params = [];
  if (!info) return { sets, params };
  if (info.korean_name) { sets.push('korean_name = ?'); params.push(info.korean_name); }
  if (info.supplier_name) { sets.push('supplier_name = ?'); params.push(info.supplier_name); }
  if (info.packaging) { sets.push('packaging = ?'); params.push(info.packaging); }
  if (info.min_stock != null) { sets.push('min_stock = ?'); params.push(info.min_stock); }
  if (info.order_qty != null) { sets.push('order_qty = ?'); params.push(info.order_qty); }
  return { sets, params };
}

async function findChemId(chemicalName, info) {
  if (info && info.chemical_id) return info.chemical_id;
  const [c] = await pool.query(`SELECT id FROM chemicals WHERE name = ?`, [chemicalName]);
  return c.length ? c[0].id : null;
}

// Cộng dồn vào dòng tháng của 1 hóa chất (chỉ gọi cho kỳ đang mở)
async function adjustRow(periodId, chemicalName, { manualIn = 0, excelIn = 0, out = 0, info = null } = {}) {
  const [rows] = await pool.query(`SELECT id FROM monthly_rows WHERE period_id = ? AND chemical_name = ?`, [periodId, chemicalName]);
  if (!rows.length) {
    const chemical_id = await findChemId(chemicalName, info);
    await pool.query(
      `INSERT INTO monthly_rows (period_id, chemical_id, chemical_name, korean_name, supplier_name, packaging, min_stock, order_qty, opening_stock, manual_in, excel_in, stock_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
      [periodId, chemical_id, chemicalName, info?.korean_name || null, info?.supplier_name || null, info?.packaging || null, info?.min_stock || 0, info?.order_qty || 0, manualIn, excelIn, out]
    );
    return;
  }
  const { sets, params } = infoSets(info);
  sets.unshift('manual_in = manual_in + ?', 'excel_in = excel_in + ?', 'stock_out = stock_out + ?');
  params.unshift(manualIn, excelIn, out);
  params.push(rows[0].id);
  await pool.query(`UPDATE monthly_rows SET ${sets.join(', ')} WHERE id = ?`, params);
}

// Nhập file tồn kho: Nhập Excel của tháng = đúng số STOCK IN trong file (ghi đè, không cộng dồn),
// nhập lại file sửa sai trong cùng tháng vẫn đúng số.
async function setImportRow(periodId, chemicalName, stockIn, info = null) {
  const [rows] = await pool.query(`SELECT id FROM monthly_rows WHERE period_id = ? AND chemical_name = ?`, [periodId, chemicalName]);
  if (!rows.length) {
    const chemical_id = await findChemId(chemicalName, info);
    await pool.query(
      `INSERT INTO monthly_rows (period_id, chemical_id, chemical_name, korean_name, supplier_name, packaging, min_stock, order_qty, opening_stock, manual_in, excel_in, stock_out)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, 0)`,
      [periodId, chemical_id, chemicalName, info?.korean_name || null, info?.supplier_name || null, info?.packaging || null, info?.min_stock || 0, info?.order_qty || 0, stockIn]
    );
    return;
  }
  const { sets, params } = infoSets(info);
  sets.unshift('excel_in = ?');
  params.unshift(stockIn);
  params.push(rows[0].id);
  await pool.query(`UPDATE monthly_rows SET ${sets.join(', ')} WHERE id = ?`, params);
}

// Xóa tất cả kho: xóa luôn các dòng của kỳ đang mở (các tháng đã chốt giữ nguyên)
async function clearOpenPeriodRows() {
  const open = await getOpenPeriod();
  if (open) await pool.query(`DELETE FROM monthly_rows WHERE period_id = ?`, [open.id]);
}

function shapeRow(r, live) {
  return {
    chemical_id: r.chemical_id || null,
    chemical_name: r.chemical_name,
    korean_name: r.korean_name || '',
    supplier_name: r.supplier_name || '',
    packaging: r.packaging || '',
    min_stock: num(r.min_stock),
    order_qty: num(r.order_qty),
    opening_stock: num(r.opening_stock),
    stock_in: num(r.manual_in) + num(r.excel_in),
    stock_out: num(r.stock_out),
    closing: live ? live.total : num(r.closing_stock),
    expiry: live ? (live.expiry_date || '') : (r.expiry_date || ''),
    order_note: r.order_note || '',
  };
}

// Kỳ đang mở: thông tin hóa chất + NCC + hạn dùng lấy live cho khớp tab Kho cũ,
// Tồn cuối = tồn thực tế (không lưu riêng nên không bao giờ lệch kho thật)
async function getCurrentView() {
  const period = await ensureCurrentPeriod();
  const [rows] = await pool.query(`SELECT * FROM monthly_rows WHERE period_id = ? ORDER BY chemical_name`, [period.id]);
  const live = await getLiveTotals();
  const [chems] = await pool.query(`SELECT * FROM chemicals`);
  const chemByName = new Map(chems.map((c) => [c.name, c]));
  const seen = new Set();
  const out = rows.map((r) => {
    seen.add(r.chemical_name);
    const lv = live.get(r.chemical_name);
    const info = chemByName.get(r.chemical_name) || {};
    const merged = { ...r,
      chemical_id: info.id || r.chemical_id || null,
      order_note: info.order_note || '',
      korean_name: info.korean_name || r.korean_name || '',
      packaging: info.packaging || r.packaging || '',
      min_stock: info.min_stock != null ? info.min_stock : r.min_stock,
      order_qty: info.order_qty != null ? info.order_qty : r.order_qty,
      supplier_name: (lv && lv.supplier_name) || r.supplier_name || '',
    };
    return shapeRow(merged, lv || { total: 0, expiry_date: null });
  });
  for (const [name, lv] of live) {
    if (seen.has(name)) continue;
    const info = chemByName.get(name) || {};
    out.push(shapeRow({ chemical_id: info.id || null, chemical_name: name, korean_name: info.korean_name || '', supplier_name: lv.supplier_name || '', packaging: info.packaging || '', min_stock: info.min_stock || 0, order_qty: info.order_qty || 0, opening_stock: 0, manual_in: 0, excel_in: 0, stock_out: 0, order_note: info.order_note || '' }, lv));
  }
  out.sort((a, b) => (a.chemical_name || '').localeCompare(b.chemical_name || ''));
  return { period: period.period, periodLabel: labelOf(period.period), rows: out };
}

// Kỳ đã chốt: số liệu đóng băng lúc chốt, không lấy live nữa
async function getArchivedView(periodStr) {
  const [p] = await pool.query(`SELECT * FROM monthly_periods WHERE period = ?`, [periodStr]);
  if (!p.length) return null;
  if (p[0].status === 'open') return getCurrentView();
  const [rows] = await pool.query(`SELECT * FROM monthly_rows WHERE period_id = ? ORDER BY chemical_name`, [p[0].id]);
  return { period: p[0].period, periodLabel: labelOf(p[0].period), closed_at: p[0].closed_at, rows: rows.map((r) => shapeRow(r, null)) };
}

async function getPeriods() {
  const [rows] = await pool.query(`SELECT period, status, closed_at FROM monthly_periods ORDER BY period DESC`);
  return rows.map((r) => ({ period: r.period, periodLabel: labelOf(r.period), status: r.status, closed_at: r.closed_at }));
}

module.exports = {
  ensureCurrentPeriod, closeCurrentAndOpenNext, getOpenPeriod,
  adjustRow, setImportRow, clearOpenPeriodRows,
  getCurrentView, getArchivedView, getPeriods,
  labelOf, currentPeriod,
};
