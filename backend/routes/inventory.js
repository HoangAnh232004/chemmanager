const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Lấy tồn kho, xếp theo FEFO (lot hết hạn trước lên trước)
router.get('/', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT inventory.*, lots.lot_code, lots.expiry_date, chemicals.name AS chemical_name
    FROM inventory
    LEFT JOIN lots ON inventory.lot_id = lots.id
    LEFT JOIN chemicals ON lots.chemical_id = chemicals.id
    ORDER BY lots.expiry_date ASC
  `);
  res.json(rows);
});

// Cập nhật vị trí lưu trữ
router.put('/:id', async (req, res) => {
  const { location } = req.body;
  await pool.query('UPDATE inventory SET location=? WHERE id=?', [location, req.params.id]);
  res.json({ message: 'Đã cập nhật vị trí' });
});

module.exports = router;
