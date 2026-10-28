const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Gửi mail qua Gmail (cần EMAIL_USER + EMAIL_PASS trong file .env,
// EMAIL_PASS là mật khẩu ứng dụng 16 ký tự, không phải mật khẩu Gmail)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// Tạo mã xác thực 6 số
function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

async function sendVerificationCode(email, code) {
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: email,
    subject: 'Mã xác thực tài khoản - Quản lý hóa chất',
    text: `Mã xác thực tài khoản của bạn là: ${code}\nMã có hiệu lực trong 15 phút. Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email này.`,
  });
}

// Đăng ký: tài khoản đầu tiên làm admin + kích hoạt luôn, các tài khoản sau chờ duyệt
// Tài khoản mới phải xác thực Gmail bằng mã 6 số trước khi đăng nhập được
router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'Vui lòng nhập địa chỉ Gmail hợp lệ' });
  }
  const [[count]] = await pool.query('SELECT COUNT(*) AS total FROM users');
  const isFirst = count.total === 0;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const [[dupUser]] = await pool.query('SELECT id FROM users WHERE username=?', [username]);
    if (dupUser) return res.status(400).json({ message: 'Tên đăng nhập đã tồn tại' });
    const [[dupEmail]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
    if (dupEmail) return res.status(400).json({ message: 'Gmail này đã được dùng để đăng ký' });

    const code = makeCode();
    await pool.query(
      'INSERT INTO users (username, email, password_hash, role, status, email_verified, verification_code, verification_expires) VALUES (?, ?, ?, ?, ?, 0, ?, DATE_ADD(NOW(), INTERVAL 15 MINUTE))',
      [username, email, hash, isFirst ? 'admin' : 'user', isFirst ? 'active' : 'pending', code]
    );
    req.app.get('io')?.emit('data_changed', { table: 'users' });

    try {
      await sendVerificationCode(email, code);
      res.json({ message: 'Đăng ký thành công. Mã xác thực đã gửi vào Gmail của bạn.', needVerify: true, username });
    } catch (e) {
      console.error('Gửi mail thất bại:', e.message);
      res.json({ message: 'Đăng ký thành công nhưng chưa gửi được mã xác thực (chưa cấu hình email gửi). Bấm "Gửi lại mã" sau khi admin cấu hình xong.', needVerify: true, username, emailSent: false });
    }
  } catch (e) {
    console.error(e);
    res.status(400).json({ message: 'Đăng ký thất bại' });
  }
});

// Xác thực Gmail bằng mã 6 số
router.post('/verify', async (req, res) => {
  const { username, code } = req.body;
  const [[user]] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
  if (!user) return res.status(400).json({ message: 'Không tìm thấy tài khoản' });
  if (user.email_verified) return res.json({ message: 'Email đã được xác thực trước đó. Bạn có thể đăng nhập.' });
  if (!user.verification_code || String(user.verification_code) !== String(code).trim()) {
    return res.status(400).json({ message: 'Mã xác thực không đúng' });
  }
  const [[valid]] = await pool.query('SELECT id FROM users WHERE id=? AND verification_expires > NOW()', [user.id]);
  if (!valid) return res.status(400).json({ message: 'Mã xác thực đã hết hạn, vui lòng bấm "Gửi lại mã"' });
  await pool.query('UPDATE users SET email_verified=1, verification_code=NULL, verification_expires=NULL WHERE id=?', [user.id]);
  req.app.get('io')?.emit('data_changed', { table: 'users' });
  res.json({ message: user.status === 'active' ? 'Xác thực thành công. Bạn có thể đăng nhập.' : 'Xác thực thành công. Tài khoản đang chờ admin duyệt.' });
});

// Gửi lại mã xác thực
router.post('/resend-code', async (req, res) => {
  const { username } = req.body;
  const [[user]] = await pool.query('SELECT * FROM users WHERE username=?', [username]);
  if (!user) return res.status(400).json({ message: 'Không tìm thấy tài khoản' });
  if (user.email_verified) return res.json({ message: 'Email đã được xác thực trước đó. Bạn có thể đăng nhập.' });
  if (!user.email) return res.status(400).json({ message: 'Tài khoản này chưa có Gmail để gửi mã' });
  const code = makeCode();
  await pool.query('UPDATE users SET verification_code=?, verification_expires=DATE_ADD(NOW(), INTERVAL 15 MINUTE) WHERE id=?', [code, user.id]);
  try {
    await sendVerificationCode(user.email, code);
    res.json({ message: 'Đã gửi lại mã xác thực vào Gmail của bạn.' });
  } catch (e) {
    console.error('Gửi mail thất bại:', e.message);
    res.status(500).json({ message: 'Chưa gửi được mã (chưa cấu hình email gửi). Liên hệ admin.' });
  }
});

// Đăng nhập: dùng tên đăng nhập hoặc Gmail; chỉ tài khoản đã xác thực email
// (tài khoản cũ chưa có email thì vẫn vào bình thường) và đã active mới vào được
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  const [[user]] = await pool.query('SELECT * FROM users WHERE username=? OR email=?', [username, username]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(400).json({ message: 'Sai tên đăng nhập hoặc mật khẩu' });
  }
  if (user.email && !user.email_verified) {
    return res.status(403).json({ message: 'Email chưa được xác thực. Vui lòng nhập mã xác thực đã gửi vào Gmail.', needVerify: true, username: user.username });
  }
  if (user.status !== 'active') {
    return res.status(403).json({ message: 'Tài khoản đang chờ admin duyệt' });
  }
  const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, process.env.JWT_SECRET || 'secret', { expiresIn: '1d' });
  res.json({ token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
});

// Admin: xem danh sách chờ duyệt
router.get('/pending', verifyToken, requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, created_at FROM users WHERE status="pending" ORDER BY id ASC');
  res.json(rows);
});

// Admin: duyệt tài khoản
router.put('/approve/:id', verifyToken, requireAdmin, async (req, res) => {
  const [[target]] = await pool.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  await pool.query('UPDATE users SET status="active" WHERE id=?', [req.params.id]);
  await pool.query('INSERT INTO audit_logs (user_id, username, action, table_name, record_id, detail) VALUES (?, ?, "edit", "users", ?, ?)', [req.user.id, req.user.username, req.params.id, target ? `Duyệt tài khoản ${target.username}` : 'Duyệt tài khoản']);
  req.app.get('io')?.emit('data_changed', { table: 'users' });
  res.json({ message: 'Đã kích hoạt tài khoản' });
});

// Admin: từ chối (xóa) tài khoản
router.delete('/reject/:id', verifyToken, requireAdmin, async (req, res) => {
  const [[target]] = await pool.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  await pool.query('INSERT INTO audit_logs (user_id, username, action, table_name, record_id, detail) VALUES (?, ?, "delete", "users", ?, ?)', [req.user.id, req.user.username, req.params.id, target ? `Từ chối tài khoản ${target.username}` : 'Từ chối tài khoản']);
  req.app.get('io')?.emit('data_changed', { table: 'users' });
  res.json({ message: 'Đã từ chối tài khoản' });
});

// Admin: xem tất cả tài khoản (để quản lý vai trò)
router.get('/users', verifyToken, requireAdmin, async (req, res) => {
  const [rows] = await pool.query('SELECT id, username, role, status, created_at FROM users ORDER BY id ASC');
  res.json(rows);
});

// Admin: đổi vai trò tài khoản (có hiệu lực sau khi tài khoản đó đăng nhập lại,
// vì vai trò nằm trong token cấp lúc đăng nhập)
router.put('/role/:id', verifyToken, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    return res.status(400).json({ message: 'Vai trò không hợp lệ' });
  }
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Không đổi được vai trò của chính mình' });
  }
  const [[target]] = await pool.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  await pool.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  await pool.query('INSERT INTO audit_logs (user_id, username, action, table_name, record_id, detail) VALUES (?, ?, "edit", "users", ?, ?)', [req.user.id, req.user.username, req.params.id, target ? `Đổi vai trò tài khoản ${target.username} thành ${role}` : `Đổi vai trò thành ${role}`]);
  req.app.get('io')?.emit('data_changed', { table: 'users' });
  res.json({ message: 'Đã đổi vai trò' });
});

// Admin: xóa tài khoản (không xóa được chính mình để khỏi mất admin)
router.delete('/users/:id', verifyToken, requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ message: 'Không xóa được tài khoản của chính mình' });
  }
  const [[target]] = await pool.query('SELECT username FROM users WHERE id=?', [req.params.id]);
  await pool.query('DELETE FROM users WHERE id=?', [req.params.id]);
  await pool.query('INSERT INTO audit_logs (user_id, username, action, table_name, record_id, detail) VALUES (?, ?, "delete", "users", ?, ?)', [req.user.id, req.user.username, req.params.id, target ? `Xóa tài khoản ${target.username}` : 'Xóa tài khoản']);
  req.app.get('io')?.emit('data_changed', { table: 'users' });
  res.json({ message: 'Đã xóa tài khoản' });
});

module.exports = router;
