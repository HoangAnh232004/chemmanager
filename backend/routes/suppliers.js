const express = require('express');
const { pool } = require('../db');
const router = express.Router();

router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM suppliers ORDER BY id DESC');
  res.json(rows);
});

// Thêm nhà cung cấp
router.post('/', async (req, res) => {
  const { name, chemical_name, contact, phone, price, email } = req.body;
  const [result] = await pool.query(
    'INSERT INTO suppliers (name, chemical_name, contact, phone, price, email) VALUES (?, ?, ?, ?, ?, ?)',
    [name, chemical_name || null, contact || null, phone || null, price || null, email || null]
  );
  res.json({ id: result.insertId, message: 'Đã thêm nhà cung cấp' });
});

router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM suppliers WHERE id=?', [req.params.id]);
  res.json({ message: 'Đã xóa' });
});

// So sánh tên như khi nhập file: bỏ dấu tiếng Việt, bỏ khoảng trắng và dấu câu,
// không phân biệt hoa thường (vd 'CÔNG TY HOÁ CHẤT A' khớp 'cong ty hoa chat a')
function normName(v) {
  return String(v === undefined || v === null ? '' : v)
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/Đ/g, 'D')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Sửa nhà cung cấp: nếu tên mới trùng với NCC khác đã có thì gộp thành 1 dòng —
// cập nhật dòng đã có bằng dữ liệu vừa sửa, chuyển các lot của dòng đang sửa sang
// dòng đó rồi xóa dòng đang sửa (không để sót 2 dòng trùng tên, không làm hỏng lot)
router.put('/:id', async (req, res) => {
  const { name, chemical_name, contact, phone, price, email } = req.body;
  const id = Number(req.params.id);
  const norm = normName(name);
  const [rows] = await pool.query('SELECT id, name FROM suppliers');
  const dup = norm ? rows.find((s) => s.id !== id && normName(s.name) === norm) : undefined;
  if (dup) {
    await pool.query(
      'UPDATE suppliers SET name=?, chemical_name=?, contact=?, phone=?, price=?, email=? WHERE id=?',
      [name, chemical_name || null, contact || null, phone || null, price || null, email || null, dup.id]
    );
    await pool.query('UPDATE lots SET supplier_id=? WHERE supplier_id=?', [dup.id, id]);
    await pool.query('DELETE FROM suppliers WHERE id=?', [id]);
    return res.json({ message: `Tên trùng với nhà cung cấp "${dup.name}" nên đã gộp lại thành 1 dòng` });
  }
  await pool.query(
    'UPDATE suppliers SET name=?, chemical_name=?, contact=?, phone=?, price=?, email=? WHERE id=?',
    [name, chemical_name || null, contact || null, phone || null, price || null, email || null, req.params.id]
  );
  res.json({ message: 'Đã cập nhật nhà cung cấp' });
});

module.exports = router;
