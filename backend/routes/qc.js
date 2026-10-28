const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Lấy tất cả phiếu QC kèm mã lot
router.get('/', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT qc_tests.*, lots.lot_code
    FROM qc_tests
    LEFT JOIN lots ON qc_tests.lot_id = lots.id
    ORDER BY qc_tests.id DESC
  `);
  res.json(rows);
});

// Cập nhật kết quả QC: pass hoặc fail
router.put('/:id', async (req, res) => {
  const { status, result, tested_by } = req.body;
  await pool.query(
    'UPDATE qc_tests SET status=?, result=?, tested_by=? WHERE id=?',
    [status, result, tested_by, req.params.id]
  );
  res.json({ message: 'Đã cập nhật QC' });
});

module.exports = router;
