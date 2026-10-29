const express = require('express');
const { pool } = require('../db');
const monthly = require('../monthly');
const router = express.Router();

// Lấy tất cả lot kèm tên hóa chất và nhà cung cấp
router.get('/', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT lots.*, chemicals.name AS chemical_name, suppliers.name AS supplier_name
    FROM lots
    LEFT JOIN chemicals ON lots.chemical_id = chemicals.id
    LEFT JOIN suppliers ON lots.supplier_id = suppliers.id
    ORDER BY lots.id DESC
  `);
  res.json(rows);
});

// Danh sách xuất kho: gộp các lần trừ cùng ngày + cùng hóa chất + cùng ghi chú thành 1 dòng
// (1 lần xuất có thể trừ từ nhiều lot nên không gộp sẽ hiện nhiều dòng cho cùng 1 lần xuất)
router.get('/exports', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT COALESCE(sm.export_date, DATE(sm.created_at)) AS export_date, c.name AS chemical_name, sm.note, SUM(sm.quantity) AS quantity
    FROM stock_movements sm
    JOIN lots l ON l.id = sm.lot_id
    JOIN chemicals c ON c.id = l.chemical_id
    WHERE sm.action = 'export'
    GROUP BY COALESCE(sm.export_date, DATE(sm.created_at)), c.id, sm.note
    ORDER BY export_date DESC, chemical_name ASC
  `);
  res.json(rows);
});

// Ghi chú đặt hàng của từng hóa chất ở tab Kho: chọn "Đã đặt" khi đã đặt
// hàng bên ngoài (lưu vào chemicals.order_note; không ghi lịch sử hoạt động,
// xem middleware/audit.js). Gắn ở router lots vì file routes/chemicals.js
// chưa có trong bộ file này — có file đó thì chuyển endpoint sang cho đúng chỗ.
router.put('/chemical-note/:id', async (req, res) => {
  try {
    const note = req.body?.order_note || '';
    if (note !== '' && note !== 'Đã đặt') return res.status(400).json({ message: 'Ghi chú không hợp lệ' });
    const [r] = await pool.query('UPDATE chemicals SET order_note=? WHERE id=?', [note, req.params.id]);
    if (!r.affectedRows) return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    res.json({ message: 'Đã lưu ghi chú' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Lưu ghi chú thất bại' });
  }
});

// Nhập lot mới: tự tạo tồn kho + phiếu QC chờ kiểm
router.post('/', async (req, res) => {
  try {
    // Kỳ kho tháng phải chốt trước khi ghi (sang tháng mới thì lot này thuộc tháng mới)
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    let { lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date } = req.body;
    // Không nhập mã lot nữa: hệ thống tự sinh mã theo thời gian (vd LOT-20261027-091500-123)
    if (!lot_code || !String(lot_code).trim()) {
      const now = new Date();
      const pad = (n, l = 2) => String(n).padStart(l, '0');
      lot_code = `LOT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
    } else {
      lot_code = String(lot_code).trim();
    }
    const [result] = await pool.query(
      'INSERT INTO lots (lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "manual")',
      [lot_code, chemical_id, supplier_id || null, quantity, unit || 'kg', purity || null, expiry_date || null, received_date || null]
    );
    const lotId = result.insertId;
    await pool.query('INSERT INTO inventory (lot_id, quantity_available) VALUES (?, ?)', [lotId, quantity]);
    await pool.query('INSERT INTO qc_tests (lot_id, status) VALUES (?, "quarantine")', [lotId]);
    await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note) VALUES (?, "import", ?, "Nhập kho")', [lotId, quantity]);
    // Kho tháng: lot nhập tay cộng vào Nhập của kỳ đang mở
    if (openPeriod) {
      try {
        const [[chem]] = await pool.query('SELECT name FROM chemicals WHERE id = ?', [chemical_id]);
        if (chem) await monthly.adjustRow(openPeriod.id, chem.name, { manualIn: Number(quantity) || 0 });
      } catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    }
    res.json({ id: lotId, message: 'Đã nhập lot' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Mã lot đã tồn tại' });
    }
    console.error(err);
    res.status(500).json({ message: 'Nhập lot thất bại' });
  }
});

// Xuất kho: trừ số lượng khỏi các lot của 1 hóa chất theo thứ tự cũ trước (FIFO),
// ghi lịch sử di chuyển cho từng lot bị trừ. Kho tổng giảm đúng bằng số lượng xuất.
router.post('/export', async (req, res) => {
  try {
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    const { chemical_id, quantity, note, export_date } = req.body;
    const qty = Number(quantity);
    if (!chemical_id) return res.status(400).json({ message: 'Chưa chọn hóa chất' });
    if (!qty || qty <= 0) return res.status(400).json({ message: 'Số lượng xuất phải lớn hơn 0' });
    const [[chem]] = await pool.query('SELECT name FROM chemicals WHERE id = ?', [chemical_id]);
    if (!chem) return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    const [rows] = await pool.query(
      `SELECT l.id AS lot_id, i.id AS inv_id, i.quantity_available AS available
       FROM lots l JOIN inventory i ON i.lot_id = l.id
       WHERE l.chemical_id = ? AND i.quantity_available > 0
       ORDER BY l.id ASC`,
      [chemical_id]
    );
    const total = rows.reduce((sum, r) => sum + Number(r.available), 0);
    if (total < qty) {
      return res.status(400).json({ message: `Số lượng xuất vượt quá tồn kho hiện tại (${total} kg)` });
    }
    let remaining = qty;
    let lotsUsed = 0;
    for (const r of rows) {
      if (remaining <= 0) break;
      const avail = Number(r.available);
      const take = Math.min(avail, remaining);
      await pool.query('UPDATE inventory SET quantity_available = ? WHERE id = ?', [avail - take, r.inv_id]);
      // Ngày xuất lưu riêng dạng DATE theo đúng ngày trên form (không suy ra từ created_at nữa
      // vì TIMESTAMP bị lệch ngày theo múi giờ của MySQL); không gửi ngày thì để NULL,
      // danh sách sẽ hiện theo ngày từ created_at như trước
      const movementNote = note && String(note).trim() ? String(note).trim() : 'Xuất kho';
      const exportDate = export_date && /^\d{4}-\d{2}-\d{2}$/.test(String(export_date)) ? String(export_date) : null;
      await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note, export_date) VALUES (?, "export", ?, ?, ?)', [r.lot_id, take, movementNote, exportDate]);
      remaining -= take;
      lotsUsed++;
    }
    // Kho tháng: lần xuất này cộng vào Xuất của kỳ đang mở
    if (openPeriod) {
      try { await monthly.adjustRow(openPeriod.id, chem.name, { out: qty }); }
      catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    }
    res.json({ message: `Đã xuất ${qty} kg ${chem.name}. Tồn còn lại: ${total - qty} kg (trừ từ ${lotsUsed} lot)` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Xuất kho thất bại' });
  }
});

// Sửa lần xuất: hoàn lại số lượng cũ vào kho rồi trừ lại theo số lượng/ngày/ghi chú mới.
// Danh sách gộp theo ngày + hóa chất + ghi chú nên 1 dòng có thể gồm nhiều lần trừ từ nhiều lot.
// Đặt trước PUT/DELETE '/:id' vì Express khớp ':id' với cả 'exports'.
router.put('/exports', async (req, res) => {
  try {
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    const { oldDate, oldChemical, oldNote, chemical_id, quantity, export_date, note } = req.body;
    const qty = Number(quantity);
    if (!oldDate || !oldChemical) return res.status(400).json({ message: 'Thiếu thông tin lần xuất cần sửa' });
    if (!chemical_id) return res.status(400).json({ message: 'Chưa chọn hóa chất' });
    if (!qty || qty <= 0) return res.status(400).json({ message: 'Số lượng xuất phải lớn hơn 0' });
    const [[oldChem]] = await pool.query('SELECT id, name FROM chemicals WHERE name = ?', [oldChemical]);
    if (!oldChem) return res.status(404).json({ message: 'Không tìm thấy hóa chất cũ' });
    const [[newChem]] = await pool.query('SELECT id, name FROM chemicals WHERE id = ?', [chemical_id]);
    if (!newChem) return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    const [movements] = await pool.query(
      `SELECT sm.id, sm.lot_id, sm.quantity FROM stock_movements sm
       JOIN lots l ON l.id = sm.lot_id
       WHERE sm.action = 'export' AND l.chemical_id = ? AND COALESCE(sm.export_date, DATE(sm.created_at)) = ? AND sm.note <=> ?`,
      [oldChem.id, oldDate, oldNote ?? null]
    );
    if (!movements.length) return res.status(404).json({ message: 'Không tìm thấy lần xuất này' });
    const oldQty = movements.reduce((sum, m) => sum + Number(m.quantity), 0);
    const [[stockRow]] = await pool.query(
      'SELECT COALESCE(SUM(i.quantity_available), 0) AS total FROM lots l JOIN inventory i ON i.lot_id = l.id WHERE l.chemical_id = ?',
      [newChem.id]
    );
    const available = Number(stockRow.total) + (newChem.id === oldChem.id ? oldQty : 0);
    if (qty > available) {
      return res.status(400).json({ message: `Số lượng xuất vượt quá tồn kho hiện tại (${available} kg)` });
    }
    for (const m of movements) {
      await pool.query('UPDATE inventory SET quantity_available = quantity_available + ? WHERE lot_id = ?', [m.quantity, m.lot_id]);
      await pool.query('DELETE FROM stock_movements WHERE id = ?', [m.id]);
    }
    const [rows] = await pool.query(
      `SELECT l.id AS lot_id, i.id AS inv_id, i.quantity_available AS available
       FROM lots l JOIN inventory i ON i.lot_id = l.id
       WHERE l.chemical_id = ? AND i.quantity_available > 0
       ORDER BY l.id ASC`,
      [newChem.id]
    );
    const movementNote = note && String(note).trim() ? String(note).trim() : 'Xuất kho';
    const exportDate = export_date && /^\d{4}-\d{2}-\d{2}$/.test(String(export_date)) ? String(export_date) : null;
    let remaining = qty;
    for (const r of rows) {
      if (remaining <= 0) break;
      const avail = Number(r.available);
      const take = Math.min(avail, remaining);
      await pool.query('UPDATE inventory SET quantity_available = ? WHERE id = ?', [avail - take, r.inv_id]);
      await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note, export_date) VALUES (?, "export", ?, ?, ?)', [r.lot_id, take, movementNote, exportDate]);
      remaining -= take;
    }
    // Kho tháng: lần xuất cũ chỉ trừ khỏi Xuất khi nó thuộc kỳ đang mở (tháng đã chốt không sửa);
    // lần xuất mới luôn thuộc kỳ đang mở
    if (openPeriod) {
      try {
        if (oldDate.slice(0, 7) === openPeriod.period) await monthly.adjustRow(openPeriod.id, oldChem.name, { out: -oldQty });
        await monthly.adjustRow(openPeriod.id, newChem.name, { out: qty });
      } catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    }
    res.json({ message: `Đã sửa lần xuất thành ${qty} kg ${newChem.name}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Sửa lần xuất thất bại' });
  }
});

// Xóa lần xuất: hoàn lại số lượng vào kho rồi xóa các lần trừ thuộc dòng đó
router.delete('/exports', async (req, res) => {
  try {
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    const { date, chemical, note } = req.body;
    if (!date || !chemical) return res.status(400).json({ message: 'Thiếu thông tin lần xuất cần xóa' });
    const [[chem]] = await pool.query('SELECT id, name FROM chemicals WHERE name = ?', [chemical]);
    if (!chem) return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    const [movements] = await pool.query(
      `SELECT sm.id, sm.lot_id, sm.quantity FROM stock_movements sm
       JOIN lots l ON l.id = sm.lot_id
       WHERE sm.action = 'export' AND l.chemical_id = ? AND COALESCE(sm.export_date, DATE(sm.created_at)) = ? AND sm.note <=> ?`,
      [chem.id, date, note ?? null]
    );
    if (!movements.length) return res.status(404).json({ message: 'Không tìm thấy lần xuất này' });
    const total = movements.reduce((sum, m) => sum + Number(m.quantity), 0);
    for (const m of movements) {
      await pool.query('UPDATE inventory SET quantity_available = quantity_available + ? WHERE lot_id = ?', [m.quantity, m.lot_id]);
      await pool.query('DELETE FROM stock_movements WHERE id = ?', [m.id]);
    }
    // Kho tháng: lần xuất bị xóa chỉ trừ khỏi Xuất khi nó thuộc kỳ đang mở
    if (openPeriod && date.slice(0, 7) === openPeriod.period) {
      try { await monthly.adjustRow(openPeriod.id, chem.name, { out: -total }); }
      catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    }
    res.json({ message: `Đã xóa lần xuất ${total} kg ${chem.name}, số lượng đã hoàn lại vào kho` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Xóa lần xuất thất bại' });
  }
});

// Sửa lot: đổi thông tin lot; nếu tồn khả dụng đang bằng đúng số lượng cũ
// (lot nhập tay, chưa xuất gì) thì tồn cũng đổi theo số lượng mới.
// Lot nhập từ file tồn kho (tồn = CLOSING khác số lượng nhập) thì tồn giữ nguyên.
router.put('/:id', async (req, res) => {
  try {
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    const { lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date } = req.body;
    const [[old]] = await pool.query('SELECT quantity, lot_code, chemical_id, source, received_date FROM lots WHERE id = ?', [req.params.id]);
    if (!old) return res.status(404).json({ message: 'Không tìm thấy lot' });
    // Form sửa không còn ô mã lot: không gửi mã lên thì giữ mã cũ
    const newCode = lot_code && String(lot_code).trim() ? String(lot_code).trim() : old.lot_code;
    await pool.query(
      'UPDATE lots SET lot_code=?, chemical_id=?, supplier_id=?, quantity=?, unit=?, purity=?, expiry_date=?, received_date=? WHERE id=?',
      [newCode, chemical_id, supplier_id || null, quantity, unit || 'kg', purity || null, expiry_date || null, received_date || null, req.params.id]
    );
    const [[inv]] = await pool.query('SELECT id, quantity_available FROM inventory WHERE lot_id = ?', [req.params.id]);
    if (inv && Math.abs(Number(inv.quantity_available) - Number(old.quantity)) < 0.001) {
      await pool.query('UPDATE inventory SET quantity_available = ? WHERE id = ?', [quantity, inv.id]);
    }
    // Kho tháng: chỉ lot nhập tay thuộc kỳ đang mở mới đổi Nhập (lot Excel do file nhập quản,
    // lot tháng cũ đã chốt thì không động vào)
    if (openPeriod && old.source === 'manual') {
      try {
        const oldMonth = old.received_date ? String(old.received_date).slice(0, 7) : openPeriod.period;
        const newMonth = received_date ? String(received_date).slice(0, 7) : openPeriod.period;
        if (oldMonth === openPeriod.period) {
          const [[oldChem]] = await pool.query('SELECT name FROM chemicals WHERE id = ?', [old.chemical_id]);
          if (oldChem) await monthly.adjustRow(openPeriod.id, oldChem.name, { manualIn: -Number(old.quantity) });
        }
        if (newMonth === openPeriod.period) {
          const [[newChem]] = await pool.query('SELECT name FROM chemicals WHERE id = ?', [chemical_id]);
          if (newChem) await monthly.adjustRow(openPeriod.id, newChem.name, { manualIn: Number(quantity) });
        }
      } catch (me) { console.error('Lỗi ghi kho tháng:', me); }
    }
    res.json({ message: 'Đã cập nhật lot' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Mã lot đã tồn tại' });
    }
    console.error(err);
    res.status(500).json({ message: 'Sửa lot thất bại' });
  }
});

// Xóa lot: xóa kèm tồn kho, phiếu QC và lịch sử di chuyển của lot đó
router.delete('/:id', async (req, res) => {
  try {
    let openPeriod = null;
    try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
    const [[lot]] = await pool.query('SELECT l.id, l.chemical_id, l.quantity, l.source, l.received_date, c.name AS chemical_name FROM lots l LEFT JOIN chemicals c ON c.id = l.chemical_id WHERE l.id = ?', [req.params.id]);
    if (!lot) return res.status(404).json({ message: 'Không tìm thấy lot' });
    // Kho tháng: chỉ lot nhập tay thuộc kỳ đang mở mới trừ Nhập
    if (openPeriod && lot.source === 'manual' && lot.chemical_name) {
      const lotMonth = lot.received_date ? String(lot.received_date).slice(0, 7) : openPeriod.period;
      if (lotMonth === openPeriod.period) {
        try { await monthly.adjustRow(openPeriod.id, lot.chemical_name, { manualIn: -Number(lot.quantity) }); }
        catch (me) { console.error('Lỗi ghi kho tháng:', me); }
      }
    }
    await pool.query('DELETE FROM inventory WHERE lot_id = ?', [req.params.id]);
    await pool.query('DELETE FROM qc_tests WHERE lot_id = ?', [req.params.id]);
    await pool.query('DELETE FROM stock_movements WHERE lot_id = ?', [req.params.id]);
    await pool.query('DELETE FROM lots WHERE id = ?', [req.params.id]);
    res.json({ message: 'Đã xóa lot' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Xóa lot thất bại' });
  }
});

module.exports = router;
