const express = require('express');
const monthly = require('../monthly');
const { pool } = require('../db');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Kỳ kho đang mở (kèm toàn bộ dòng tháng hiện tại)
router.get('/current', async (req, res) => {
  try {
    res.json(await monthly.getCurrentView());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được kho tháng' });
  }
});

// Danh sách các kỳ (mở + đã chốt) để chọn ở tab Lưu trữ
router.get('/periods', async (req, res) => {
  try {
    res.json(await monthly.getPeriods());
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được danh sách kỳ' });
  }
});

// Xem 1 kỳ (tháng đã chốt thì số liệu đóng băng; kỳ đang mở thì tính live như /current)
// Đặt sau '/current' và '/periods' để Express không khớp nhầm chúng thành :period
router.get('/:period', async (req, res) => {
  try {
    if (!/^\d{4}-\d{2}$/.test(req.params.period)) return res.status(400).json({ message: 'Kỳ không hợp lệ' });
    const view = await monthly.getArchivedView(req.params.period);
    if (!view) return res.status(404).json({ message: 'Không tìm thấy kỳ này' });
    res.json(view);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Không tải được kỳ' });
  }
});

// Chốt tháng (chỉ admin): đóng kỳ đang mở, mở kỳ tháng tiếp theo
// (tồn đầu kỳ mới = tồn cuối kỳ vừa đóng, Nhập/Xuất về 0)
router.post('/close', requireAdmin, async (req, res) => {
  try {
    const opened = await monthly.closeCurrentAndOpenNext();
    req.app.get('io')?.emit('data_changed', { table: 'monthly' });
    res.json({ message: `Đã chốt tháng, kỳ mới: ${monthly.labelOf(opened.period)}`, period: opened.period, periodLabel: monthly.labelOf(opened.period) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Chốt tháng thất bại' });
  }
});

// Sửa thông tin hóa chất của 1 dòng ở tab Kho (tên Hàn, quy cách, tối thiểu,
// tối đa) và sửa cả Tồn: chỉ sửa bảng chemicals, không đổi tên (tên là khóa
// nối dòng tháng) và không đụng tới các kỳ đã chốt. Mọi tài khoản đều sửa
// được như tab Hóa chất. Sửa Tồn đi theo đúng luồng nhập/xuất có sẵn:
// tăng tồn thì tạo 1 lot nhập tay, giảm tồn thì trừ FIFO như xuất kho
// (ghi chú "Điều chỉnh tồn") để số liệu các tab khớp nhau.
router.put('/chemical/:id', async (req, res) => {
  try {
    const { korean_name, packaging, min_stock, order_qty, closing } = req.body || {};
    const [[chem]] = await pool.query('SELECT id, name FROM chemicals WHERE id = ?', [req.params.id]);
    if (!chem) return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    const num = (v) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    // Kiểm tra Tồn trước khi ghi gì cả để khỏi dở dang: để trống thì không
    // đụng tới tồn, nhập số thì phải >= 0
    let newClosing = null;
    if (closing !== '' && closing !== null && closing !== undefined) {
      newClosing = Number(closing);
      if (!Number.isFinite(newClosing) || newClosing < 0) {
        return res.status(400).json({ message: 'Tồn phải là số lớn hơn hoặc bằng 0' });
      }
    }
    await pool.query(
      'UPDATE chemicals SET korean_name = ?, packaging = ?, min_stock = ?, order_qty = ? WHERE id = ?',
      [korean_name || '', packaging || '', num(min_stock), num(order_qty), req.params.id]
    );
    // Sửa Tồn: chênh lệch so với tồn thực tế thì nhập/xuất bù cho khớp
    if (newClosing !== null) {
      const [[t]] = await pool.query(
        'SELECT COALESCE(SUM(i.quantity_available), 0) AS total FROM lots l JOIN inventory i ON i.lot_id = l.id WHERE l.chemical_id = ?',
        [chem.id]
      );
      const total = Number(t.total) || 0;
      const diff = newClosing - total;
      if (Math.abs(diff) >= 0.001) {
        let openPeriod = null;
        try { openPeriod = await monthly.ensureCurrentPeriod(); } catch (me) { console.error('Lỗi kỳ kho tháng:', me); }
        if (diff > 0) {
          // Tăng tồn: tạo 1 lot nhập tay như nhập kho bình thường
          const now = new Date();
          const pad = (n, l = 2) => String(n).padStart(l, '0');
          const lotCode = `LOT-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
          const receivedDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
          const [[latest]] = await pool.query('SELECT supplier_id FROM lots WHERE chemical_id = ? ORDER BY id DESC LIMIT 1', [chem.id]);
          const [result] = await pool.query(
            'INSERT INTO lots (lot_code, chemical_id, supplier_id, quantity, unit, purity, expiry_date, received_date, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, "manual")',
            [lotCode, chem.id, latest ? latest.supplier_id : null, diff, 'kg', null, null, receivedDate]
          );
          const lotId = result.insertId;
          await pool.query('INSERT INTO inventory (lot_id, quantity_available) VALUES (?, ?)', [lotId, diff]);
          await pool.query('INSERT INTO qc_tests (lot_id, status) VALUES (?, "quarantine")', [lotId]);
          await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note) VALUES (?, "import", ?, "Điều chỉnh tồn")', [lotId, diff]);
          if (openPeriod) {
            try { await monthly.adjustRow(openPeriod.id, chem.name, { manualIn: diff }); }
            catch (me) { console.error('Lỗi ghi kho tháng:', me); }
          }
        } else {
          // Giảm tồn: trừ FIFO như xuất kho, ghi chú "Điều chỉnh tồn"
          const [rows] = await pool.query(
            `SELECT l.id AS lot_id, i.id AS inv_id, i.quantity_available AS available
             FROM lots l JOIN inventory i ON i.lot_id = l.id
             WHERE l.chemical_id = ? AND i.quantity_available > 0
             ORDER BY l.id ASC`,
            [chem.id]
          );
          let remaining = -diff;
          for (const r of rows) {
            if (remaining <= 0) break;
            const avail = Number(r.available);
            const take = Math.min(avail, remaining);
            await pool.query('UPDATE inventory SET quantity_available = ? WHERE id = ?', [avail - take, r.inv_id]);
            await pool.query('INSERT INTO stock_movements (lot_id, action, quantity, note, export_date) VALUES (?, "export", ?, "Điều chỉnh tồn", NULL)', [r.lot_id, take]);
            remaining -= take;
          }
          if (openPeriod) {
            try { await monthly.adjustRow(openPeriod.id, chem.name, { out: -diff }); }
            catch (me) { console.error('Lỗi ghi kho tháng:', me); }
          }
        }
      }
    }
    req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
    res.json({ message: 'Đã sửa hóa chất' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Sửa thất bại' });
  }
});

// Xóa hẳn 1 hóa chất khỏi hệ thống (chỉ admin): xóa dòng bán hàng, lịch sử
// di chuyển, phiếu QC, tồn kho và lot của nó rồi mới xóa hóa chất và dòng
// tháng của nó ở mọi kỳ, chạy trong 1 transaction cho khỏi dở dang.
router.delete('/chemical/:id', requireAdmin, async (req, res) => {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[chem]] = await conn.query('SELECT id, name FROM chemicals WHERE id = ?', [req.params.id]);
    if (!chem) {
      await conn.rollback();
      return res.status(404).json({ message: 'Không tìm thấy hóa chất' });
    }
    const [lots] = await conn.query('SELECT id FROM lots WHERE chemical_id = ?', [chem.id]);
    const lotIds = lots.map((l) => l.id);
    if (lotIds.length) {
      await conn.query('DELETE FROM sales WHERE lot_id IN (?)', [lotIds]);
      await conn.query('DELETE FROM stock_movements WHERE lot_id IN (?)', [lotIds]);
      await conn.query('DELETE FROM qc_tests WHERE lot_id IN (?)', [lotIds]);
      await conn.query('DELETE FROM inventory WHERE lot_id IN (?)', [lotIds]);
      await conn.query('DELETE FROM lots WHERE id IN (?)', [lotIds]);
    }
    await conn.query('DELETE FROM monthly_rows WHERE chemical_name = ?', [chem.name]);
    await conn.query('DELETE FROM chemicals WHERE id = ?', [chem.id]);
    await conn.commit();
    req.app.get('io')?.emit('data_changed', { table: 'chemicals' });
    res.json({ message: `Đã xóa hẳn hóa chất ${chem.name}` });
  } catch (e) {
    await conn.rollback().catch(() => {});
    console.error(e);
    res.status(500).json({ message: 'Xóa thất bại' });
  } finally {
    conn.release();
  }
});

// Xóa dòng tháng của hóa chất chưa có trong danh mục (chỉ admin): chỉ xóa
// dòng tháng ở mọi kỳ, không có lot hay hóa chất để xóa kèm.
router.delete('/row/:name', requireAdmin, async (req, res) => {
  try {
    const [r] = await pool.query('DELETE FROM monthly_rows WHERE chemical_name = ?', [req.params.name]);
    req.app.get('io')?.emit('data_changed', { table: 'monthly' });
    res.json({ message: r.affectedRows ? `Đã xóa dòng ${req.params.name} khỏi các kỳ` : 'Không tìm thấy dòng này' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Xóa thất bại' });
  }
});

module.exports = router;
