const express = require('express');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

router.get('/', verifyToken, requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200');

  await pool.query(`DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL 7 DAY`);

  res.json(rows);
});

module.exports = router;
