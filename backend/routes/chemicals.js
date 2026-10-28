const express = require('express');
const { pool } = require('../db');
const router = express.Router();

// Lấy tất cả hóa chất
router.get('/', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM chemicals ORDER BY id DESC');
  res.json(rows);
});

// Thêm hóa chất mới
router.post('/', async (req, res) => {
  const { name, type, grade, standard, hazard_group, storage_condition } = req.body;
  const [result] = await pool.query(
    'INSERT INTO chemicals (name, type, grade, standard, hazard_group, storage_condition) VALUES (?, ?, ?, ?, ?, ?)',
    [name, type, grade, standard, hazard_group, storage_condition]
  );
  res.json({ id: result.insertId, message: 'Đã thêm' });
});

// Sửa hóa chất
router.put('/:id', async (req, res) => {
  const { name, type, grade, standard, hazard_group, storage_condition } = req.body;
  await pool.query(
    'UPDATE chemicals SET name=?, type=?, grade=?, standard=?, hazard_group=?, storage_condition=? WHERE id=?',
    [name, type, grade, standard, hazard_group, storage_condition, req.params.id]
  );
  res.json({ message: 'Đã sửa' });
});

// Xóa hóa chất
router.delete('/:id', async (req, res) => {
  await pool.query('DELETE FROM chemicals WHERE id=?', [req.params.id]);
  res.json({ message: 'Đã xóa' });
});

module.exports = router;
