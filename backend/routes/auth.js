const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const https = require('https');
const { pool } = require('../db');
const { verifyToken, requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Gửi mail qua API của Brevo (HTTPS, cổng 443) thay cho SMTP Gmail,
// vì Render chặn đường SMTP ra ngoài (cổng 465 và 587 đều Connection timeout).
// Cần 2 biến môi trường:
//   - BREVO_API_KEY: key API đã tạo trên Brevo (quyền Transactional email = All)
//   - EMAIL_USER: địa chỉ Gmail đã xác thực làm sender trên Brevo
// EMAIL_PASS không còn dùng nữa.
// Dùng module https có sẵn của Node nên không cần cài thêm gói nào.
// Timeout 15 giây: nếu Brevo không trả lời thì báo lỗi nhanh chứ không treo request.
function sendBrevoMail(email, subject, textContent) {
  return new Promise((resolve, reject) => {
    if (!process.env.BREVO_API_KEY) return reject(new Error('Chưa cấu hình BREVO_API_KEY'));
    if (!process.env.EMAIL_USER) return reject(new Error('Chưa cấu hình EMAIL_USER làm địa chỉ gửi'));
    const body = JSON.stringify({
      sender: { name: 'ChemManager', email: process.env.EMAIL_USER },
      to: [{ email }],
      subject,
      textContent,
    });
    const req = https.request(
      {
        hostname: 'api.brevo.com',
        path: '/v3/smtp/email',
        method: 'POST',
        timeout: 15000,
        headers: {
          accept: 'application/json',
          'api-key': process.env.BREVO_API_KEY,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) return resolve();
          reject(new Error(`Brevo trả về ${res.statusCode}: ${data}`));
        });
      }
    );
    req.on('timeout', () => req.destroy(new Error('Gọi API Brevo quá 15 giây chưa trả lời')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Mã xác thực tài khoản mới (đăng ký / gửi lại mã)
function sendVerificationCode(email, code) {
  return sendBrevoMail(
    email,
    'Mã xác thực tài khoản - Quản lý hóa chất',
    `Mã xác thực tài khoản của bạn là: ${code}\nMã có hiệu lực trong 15 phút. Nếu bạn không đăng ký tài khoản này, hãy bỏ qua email này.`
  );
}

// Mã đặt lại mật khẩu (quên mật khẩu)
function sendPasswordResetCode(email, code) {
  return sendBrevoMail(
    email,
    'Mã đặt lại mật khẩu - KhoManager',
    `Mã đặt lại mật khẩu của bạn là: ${code}\nMã có hiệu lực trong 1 phút. Nếu bạn không yêu cầu đặt lại mật khẩu, hãy bỏ qua email này.`
  );
}

// Tạo mã xác thực 6 số
function makeCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

// Đổi mật khẩu của chính tài khoản đang đăng nhập
router.post('/change-password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới ít nhất 6 ký tự' });
  }
  const [[user]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!user || !bcrypt.compareSync(currentPassword || '', user.password_hash)) {
    return res.status(400).json({ message: 'Mật khẩu hiện tại không đúng' });
  }
  const hash = bcrypt.hashSync(newPassword, 10);
  await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hash, req.user.id]);
  res.json({ message: 'Đã đổi mật khẩu' });
});

// Quên mật khẩu: gửi mã 6 số về Gmail để đặt lại mật khẩu (mã có hiệu lực 1 phút)
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const [[user]] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
  if (!user) return res.status(400).json({ message: 'Gmail này chưa được đăng ký' });
  const code = makeCode();
  try {
    await sendPasswordResetCode(email, code);
  } catch (e) {
    console.error('Gửi mail đặt lại mật khẩu thất bại:', e.message);
    return res.status(500).json({ message: 'Chưa gửi được mã (chưa cấu hình email gửi). Liên hệ admin.' });
  }
  await pool.query('UPDATE users SET reset_code=?, reset_expires=DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE id=?', [code, user.id]);
  res.json({ message: 'Mã đặt lại mật khẩu đã gửi vào Gmail của bạn. Mã có hiệu lực trong 1 phút.' });
});

// Quên mật khẩu bước 2: xác nhận mã đúng + còn hạn mới cho sang bước đặt lại
// (chỉ kiểm tra, chưa xóa mã — bước đặt lại mật khẩu sẽ kiểm tra lại mã này)
router.post('/verify-reset-code', async (req, res) => {
  const { email, code } = req.body;
  const [[user]] = await pool.query('SELECT id FROM users WHERE email=? AND reset_code=? AND reset_expires > NOW()', [email, String(code).trim()]);
  if (!user) return res.status(400).json({ message: 'Mã không đúng hoặc đã hết hạn. Bấm "Gửi lại mã" để nhận mã mới.' });
  res.json({ message: 'Mã đúng. Nhập mật khẩu mới.' });
});

// Đặt lại mật khẩu bằng mã đã gửi về Gmail (mã đúng + còn hạn mới đổi được;
// đổi xong là xác thực luôn Gmail vì giữ được mã đã chứng minh chủ sở hữu email)
router.post('/reset-password', async (req, res) => {
  const { email, code, newPassword } = req.body;
  if (!newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Mật khẩu mới ít nhất 6 ký tự' });
  }
  const [[user]] = await pool.query('SELECT id, username FROM users WHERE email=? AND reset_code=? AND reset_expires > NOW()', [email, String(code).trim()]);
  if (!user) return res.status(400).json({ message: 'Mã không đúng hoặc đã hết hạn. Bấm "Gửi lại mã" để nhận mã mới.' });
  const hash = bcrypt.hashSync(newPassword, 10);
  await pool.query('UPDATE users SET password_hash=?, reset_code=NULL, reset_expires=NULL, email_verified=1 WHERE id=?', [hash, user.id]);
  res.json({ message: 'Đã đặt lại mật khẩu. Đăng nhập bằng mật khẩu mới.' });
});

module.exports = router;
