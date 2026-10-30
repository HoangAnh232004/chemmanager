// Báo cáo sử dụng nhựa tháng (2 nguyên liệu) — bảng chi tiết theo ngày tới
// từng mã nhựa (sản xuất + sample), bảng tổng hợp, tổng kết cuối tháng,
// tồn theo bộ phận, xuất kho theo tuần, chốt tháng → lưu trữ.
// Bảng tự tạo khi server chạy (không tạo tay trong MySQL Workbench).
// Mã nhựa đúng cột trong file Excel mẫu của user. Lưu ý: DS-988 trong sheet
// tổng kết cuối tháng có số trùng hệt 655HIM-G nên coi là trùng, không tách
// riêng; 640C2P chỉ có ở bảng tổng kết/tuần (không có số liệu chi tiết).
const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const ITEMS = {
  NL1: {
    production: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670'],
    sample: ['640EW', 'BF-670', '655HIM-A', '655HIM-G', 'SB-100'],
  },
  NL2: {
    production: ['620L', 'RB-110', 'BF-670', 'BT-600'],
    sample: ['620L', 'RB-110', '640EW', 'BF-670', 'BT-600'],
  },
};
const MONTH_END_ITEMS = {
  NL1: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670', '640C2P'],
  NL2: ['620L', 'RB-110', 'BF-670', 'BT-600'],
};
const WEEKLY_ITEMS = {
  NL1: ['640EW', '655HIM-G', 'BF-670', '655HIM-A', '640C2P', 'SB-100'],
  NL2: ['620L', 'BF-670', 'BT-600', 'RB-110'],
};

async function ensureTables() {
  const sql = [
    `CREATE TABLE IF NOT EXISTS plastic_months (
      period VARCHAR(7) PRIMARY KEY,
      status VARCHAR(10) NOT NULL DEFAULT 'open',
      closed_at DATETIME NULL
    )`,
    `CREATE TABLE IF NOT EXISTS plastic_days (
      id INT AUTO_INCREMENT PRIMARY KEY,
      period VARCHAR(7) NOT NULL,
      day DATE NOT NULL,
      grp VARCHAR(5) NOT NULL,
      kind VARCHAR(12) NOT NULL,
      item VARCHAR(50) NOT NULL,
      qty DECIMAL(12,2) NOT NULL DEFAULT 0,
      UNIQUE KEY uq_day (period, day, grp, kind, item)
    )`,
    `CREATE TABLE IF NOT EXISTS plastic_stock (
      period VARCHAR(7) NOT NULL,
      grp VARCHAR(5) NOT NULL,
      opening DECIMAL(12,2) NOT NULL DEFAULT 0,
      import_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (period, grp)
    )`,
    `CREATE TABLE IF NOT EXISTS plastic_weekly (
      period VARCHAR(7) NOT NULL,
      week TINYINT NOT NULL,
      grp VARCHAR(5) NOT NULL,
      item VARCHAR(50) NOT NULL,
      qty DECIMAL(12,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (period, week, grp, item)
    )`,
    `CREATE TABLE IF NOT EXISTS plastic_month_end (
      period VARCHAR(7) NOT NULL,
      grp VARCHAR(5) NOT NULL,
      item VARCHAR(50) NOT NULL,
      stock_out DECIMAL(12,2) NOT NULL DEFAULT 0,
      return_qty DECIMAL(12,2) NOT NULL DEFAULT 0,
      PRIMARY KEY (period, grp, item)
    )`,
  ];
  for (const q of sql) await pool.query(q);
}
ensureTables().catch((err) => console.error('[plastic] ensureTables failed:', err.message));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) =>
  res.status(err.status || 500).json({ message: err.message || 'Lỗi server' }));

function bad(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function nextPeriod(p) {
  const [y, m] = p.split('-').map(Number);
  const d = new Date(y, m, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function periodLabel(p) {
  const [y, m] = p.split('-');
  return `Tháng ${Number(m)}/${y}`;
}
function validPeriod(p) {
  return /^\d{4}-\d{2}$/.test(p || '');
}
async function ensureMonth(period) {
  await pool.query(`INSERT IGNORE INTO plastic_months (period, status) VALUES (?, 'open')`, [period]);
}
async function isClosed(period) {
  const [rows] = await pool.query('SELECT status FROM plastic_months WHERE period = ?', [period]);
  return rows[0]?.status === 'closed';
}
async function assertOpen(period) {
  if (await isClosed(period)) {
    const e = new Error('Tháng đã chốt, không sửa được nữa');
    e.status = 403;
    throw e;
  }
}
async function getMonthData(period) {
  const [m] = await pool.query('SELECT * FROM plastic_months WHERE period = ?', [period]);
  const [days] = await pool.query(
    'SELECT day, grp, kind, item, qty FROM plastic_days WHERE period = ? ORDER BY day', [period]);
  const [stock] = await pool.query('SELECT * FROM plastic_stock WHERE period = ?', [period]);
  const [weekly] = await pool.query('SELECT * FROM plastic_weekly WHERE period = ?', [period]);
  const [monthEnd] = await pool.query('SELECT * FROM plastic_month_end WHERE period = ?', [period]);
  return {
    period,
    periodLabel: periodLabel(period),
    status: m[0]?.status || 'open',
    closed_at: m[0]?.closed_at || null,
    days, stock, weekly, monthEnd,
  };
}

// Kỳ làm việc = tháng dương lịch nếu còn mở; nếu tháng dương lịch đã chốt
// thì lấy tháng mở mới nhất sau nó, để bấm Chốt tháng xong là hiện ngay
// trang tháng mới (không chờ sang tháng dương lịch mới).
router.get('/current', wrap(async (req, res) => {
  const cal = currentPeriod();
  await ensureMonth(cal);
  const [calRow] = await pool.query('SELECT status FROM plastic_months WHERE period = ?', [cal]);
  if (calRow[0]?.status !== 'closed') {
    return res.json(await getMonthData(cal));
  }
  const [open] = await pool.query(
    `SELECT period FROM plastic_months WHERE status = 'open' AND period > ? ORDER BY period DESC LIMIT 1`, [cal]);
  let period = open[0]?.period;
  if (!period) {
    period = nextPeriod(cal);
    await ensureMonth(period);
  }
  res.json(await getMonthData(period));
}));

// Các tháng đã chốt (lưu trữ)
router.get('/periods', wrap(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.period, p.closed_at, COALESCE(SUM(d.qty), 0) AS total
     FROM plastic_months p LEFT JOIN plastic_days d ON d.period = p.period
     WHERE p.status = 'closed' GROUP BY p.period, p.closed_at ORDER BY p.period DESC`);
  res.json(rows);
}));

// Xem 1 kỳ (tháng đã chốt thì chỉ xem)
router.get('/:period', wrap(async (req, res) => {
  if (!validPeriod(req.params.period)) throw bad('Kỳ không hợp lệ');
  res.json(await getMonthData(req.params.period));
}));

// Sửa 1 ô số liệu theo ngày (số 0 thì xóa dòng cho gọn)
router.put('/day', wrap(async (req, res) => {
  const { period, day, grp, kind, item, qty } = req.body;
  if (!validPeriod(period) || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !String(day).startsWith(period)) throw bad('Ngày không hợp lệ');
  if (!ITEMS[grp] || !ITEMS[grp][kind] || !ITEMS[grp][kind].includes(item)) throw bad('Mã nhựa không hợp lệ');
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 0) throw bad('Số lượng không hợp lệ');
  await assertOpen(period);
  await ensureMonth(period);
  if (n === 0) {
    await pool.query('DELETE FROM plastic_days WHERE period = ? AND day = ? AND grp = ? AND kind = ? AND item = ?',
      [period, day, grp, kind, item]);
  } else {
    await pool.query(
      `INSERT INTO plastic_days (period, day, grp, kind, item, qty) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = VALUES(qty)`,
      [period, day, grp, kind, item, n]);
  }
  res.json({ ok: true });
}));

// Sửa tồn đầu / nhập của 1 bộ phận
router.put('/stock', wrap(async (req, res) => {
  const { period, grp, opening, import_qty } = req.body;
  if (!validPeriod(period) || !['NL1', 'NL2'].includes(grp)) throw bad('Dữ liệu không hợp lệ');
  const o = Number(opening), im = Number(import_qty);
  if (!Number.isFinite(o) || o < 0 || !Number.isFinite(im) || im < 0) throw bad('Số lượng không hợp lệ');
  await assertOpen(period);
  await ensureMonth(period);
  await pool.query(
    `INSERT INTO plastic_stock (period, grp, opening, import_qty) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE opening = VALUES(opening), import_qty = VALUES(import_qty)`,
    [period, grp, o, im]);
  res.json({ ok: true });
}));

// Sửa 1 ô xuất kho theo tuần
router.put('/weekly', wrap(async (req, res) => {
  const { period, week, grp, item, qty } = req.body;
  if (!validPeriod(period) || ![1, 2, 3, 4].includes(Number(week))) throw bad('Tuần không hợp lệ');
  if (!WEEKLY_ITEMS[grp] || !WEEKLY_ITEMS[grp].includes(item)) throw bad('Mã nhựa không hợp lệ');
  const n = Number(qty);
  if (!Number.isFinite(n) || n < 0) throw bad('Số lượng không hợp lệ');
  await assertOpen(period);
  await ensureMonth(period);
  if (n === 0) {
    await pool.query('DELETE FROM plastic_weekly WHERE period = ? AND week = ? AND grp = ? AND item = ?',
      [period, week, grp, item]);
  } else {
    await pool.query(
      `INSERT INTO plastic_weekly (period, week, grp, item, qty) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE qty = VALUES(qty)`,
      [period, week, grp, item, n]);
  }
  res.json({ ok: true });
}));

// Sửa STOCK OUT / TRẢ HÀNG của 1 mã ở bảng tổng kết cuối tháng
router.put('/month-end', wrap(async (req, res) => {
  const { period, grp, item, stock_out, return_qty } = req.body;
  if (!validPeriod(period) || !MONTH_END_ITEMS[grp] || !MONTH_END_ITEMS[grp].includes(item)) throw bad('Mã nhựa không hợp lệ');
  const so = Number(stock_out), rq = Number(return_qty);
  if (!Number.isFinite(so) || so < 0 || !Number.isFinite(rq) || rq < 0) throw bad('Số lượng không hợp lệ');
  await assertOpen(period);
  await ensureMonth(period);
  await pool.query(
    `INSERT INTO plastic_month_end (period, grp, item, stock_out, return_qty) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stock_out = VALUES(stock_out), return_qty = VALUES(return_qty)`,
    [period, grp, item, so, rq]);
  res.json({ ok: true });
}));

// Chốt tháng (chỉ admin): khóa sửa, chuyển vào lưu trữ, mở tháng mới
router.post('/close', requireAdmin, wrap(async (req, res) => {
  const period = req.body.period || currentPeriod();
  if (!validPeriod(period)) throw bad('Kỳ không hợp lệ');
  await ensureMonth(period);
  if (await isClosed(period)) throw bad('Tháng này đã chốt rồi');
  await pool.query(`UPDATE plastic_months SET status = 'closed', closed_at = NOW() WHERE period = ?`, [period]);
  const next = nextPeriod(period);
  await ensureMonth(next);
  res.json({ message: `Đã chốt ${periodLabel(period)}, báo cáo chuyển vào Lưu trữ. ${periodLabel(next)} đã mở.` });
}));

// Nhập file Excel bảng chi tiết (chỉ admin): tự dò hàng tiêu đề item,
// hàng nhóm (NGUYÊN LIỆU 1/2) và hàng khối (BULK/SAMPLE) qua merge cells
function parseDateCell(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'string') {
    const s = v.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/^(\d{1,2})-thg\s*(\d{1,2})-(\d{4})$/i) || s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  return null;
}

router.post('/import', requireAdmin, upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw bad('Chưa chọn file');
  const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
  let totalCells = 0;
  let skippedClosed = 0;
  const periodsTouched = new Set();
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    const merges = ws['!merges'] || [];
    const valAt = (r, c) => {
      const mg = merges.find((mm) => mm.s.r === r && c >= mm.s.c && c <= mm.e.c);
      return mg ? (aoa[mg.s.r]?.[mg.s.c] ?? '') : (aoa[r]?.[c] ?? '');
    };
    let headerRow = -1;
    for (let r = 0; r < Math.min(aoa.length, 30); r++) {
      if ((aoa[r] || []).some((v) => String(v || '').trim() === 'SB100')) { headerRow = r; break; }
    }
    if (headerRow < 0) continue;
    const groupRow = headerRow - 1;
    const sectionRow = headerRow - 2;
    const colMap = {};
    (aoa[headerRow] || []).forEach((raw, j) => {
      let item = String(raw || '').split('\n')[0].trim();
      if (item.includes('(')) item = item.split('(')[0].trim();
      if (!item || item === 'TOTAL') return;
      const g = String(valAt(groupRow, j) || '');
      const s = String(valAt(sectionRow, j) || '');
      const grp = g.includes('NGUYÊN LIỆU 1') ? 'NL1' : g.includes('NGUYÊN LIỆU 2') ? 'NL2' : null;
      const kind = /BULK/i.test(s) ? 'production' : /SAMPLE/i.test(s) ? 'sample' : null;
      if (!grp || !kind || !ITEMS[grp][kind].includes(item)) return;
      colMap[j] = { grp, kind, item };
    });
    if (Object.keys(colMap).length === 0) continue;
    const byPeriod = {};
    for (let r = headerRow + 1; r < aoa.length; r++) {
      const day = parseDateCell(aoa[r][0]);
      if (!day) continue;
      const period = day.slice(0, 7);
      (byPeriod[period] = byPeriod[period] || []).push({ day, row: aoa[r] });
    }
    for (const [period, rows] of Object.entries(byPeriod)) {
      if (await isClosed(period)) { skippedClosed += rows.length; continue; }
      await ensureMonth(period);
      for (const { day, row } of rows) {
        for (const [j, mk] of Object.entries(colMap)) {
          const raw = row[j];
          if (raw === '' || raw === null || raw === undefined || raw === '-') continue;
          const qty = Number(raw);
          if (!Number.isFinite(qty)) continue;
          if (qty === 0) {
            await pool.query('DELETE FROM plastic_days WHERE period = ? AND day = ? AND grp = ? AND kind = ? AND item = ?',
              [period, day, mk.grp, mk.kind, mk.item]);
          } else {
            await pool.query(
              `INSERT INTO plastic_days (period, day, grp, kind, item, qty) VALUES (?, ?, ?, ?, ?, ?)
               ON DUPLICATE KEY UPDATE qty = VALUES(qty)`,
              [period, day, mk.grp, mk.kind, mk.item, qty]);
          }
          totalCells++;
        }
      }
      periodsTouched.add(period);
    }
  }
  res.json({
    message: `Đã nhập ${totalCells} ô số liệu cho ${[...periodsTouched].join(', ') || 'không có tháng nào'}` +
      (skippedClosed ? ` (bỏ qua ${skippedClosed} dòng của tháng đã chốt)` : ''),
  });
}));

module.exports = router;
