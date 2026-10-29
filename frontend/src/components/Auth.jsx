import { useState } from 'react';
import api from '../api';
import './Auth.css';
import './loading.css';

// Trang đăng nhập/đăng ký chuyên nghiệp: thẻ chia đôi — trái là panel thương hiệu,
// phải là form có nhãn, icon trong ô nhập và nút ẩn/hiện mật khẩu.
// Logic đăng nhập/đăng ký/xác thực Gmail/gửi lại mã giữ nguyên.
const IconUser = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 3.6-6 8-6s8 2 8 6" />
  </svg>
);
const IconMail = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <path d="M3 7l9 6 9-6" />
  </svg>
);
const IconLock = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
  </svg>
);
const IconShield = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3l7 3v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
const IconEye = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const IconEyeOff = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M3 3l18 18" />
  </svg>
);
const IconCheck = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);
export default function Auth({ onLogin }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'verify' | 'forgot' | 'verify-reset' | 'reset'
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [verifyUsername, setVerifyUsername] = useState('');
  const [resetEmail, setResetEmail] = useState('');
  const [message, setMessage] = useState('');
  const [messageType, setMessageType] = useState('error'); // 'error' | 'success'
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true); // Ghi nhớ đăng nhập: tích sẵn
  const [loading, setLoading] = useState(false); // Đang gọi API thì nút xoay + không bấm lại được

  const showMessage = (text, type = 'error') => {
    setMessage(text);
    setMessageType(type);
  };

  const switchMode = (m) => {
    if (loading) return; // Đang gọi API thì không chuyển form để khỏi loạn
    setMode(m);
    setMessage('');
    setShowPassword(false);
  };

  // Chạy 1 gọi API kèm hiệu ứng load: đang gọi thì nút xoay + không bấm lại được,
  // gọi xong (thành công hay lỗi) thì nút trở lại bình thường
  const callApi = async (fn) => {
    setLoading(true);
    try {
      return await fn();
    } finally {
      setLoading(false);
    }
  };

  const submitLogin = async (e) => {
    e.preventDefault();
    try {
      const res = await callApi(() => api.post('/auth/login', { username, password }));
      if (remember) {
        // Ghi nhớ: tài khoản lưu ở localStorage, đóng trình duyệt mở lại vẫn còn đăng nhập
        localStorage.setItem('token', res.data.token);
        localStorage.setItem('user', JSON.stringify(res.data.user));
        sessionStorage.removeItem('token');
        sessionStorage.removeItem('user');
      } else {
        // Không ghi nhớ: token vẫn để localStorage để api.js gửi kèm được,
        // chỉ tài khoản lưu ở sessionStorage nên đóng trình duyệt là phải đăng nhập lại
        localStorage.setItem('token', res.data.token);
        localStorage.removeItem('user');
        sessionStorage.setItem('user', JSON.stringify(res.data.user));
        sessionStorage.removeItem('token');
      }
      onLogin(res.data.user);
    } catch (err) {
      const data = err.response?.data;
      if (data?.needVerify) {
        setVerifyUsername(data.username || username);
        setMode('verify');
        showMessage(data.message, 'error');
      } else {
        showMessage(data?.message || 'Có lỗi xảy ra');
      }
    }
  };

  const submitRegister = async (e) => {
    e.preventDefault();
    try {
      const res = await callApi(() => api.post('/auth/register', { username, email, password }));
      setVerifyUsername(res.data.username || username);
      setMode('verify');
      showMessage(res.data.message, 'success');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  const submitVerify = async (e) => {
    e.preventDefault();
    try {
      const res = await callApi(() => api.post('/auth/verify', { username: verifyUsername, code }));
      showMessage(res.data.message, 'success');
      setMode('login');
      setCode('');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  const resendCode = async () => {
    try {
      const res = await callApi(() => api.post('/auth/resend-code', { username: verifyUsername }));
      showMessage(res.data.message, 'success');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  // Quên mật khẩu bước 1: nhập Gmail → gửi mã 6 số, sang form đặt lại mật khẩu
  const submitForgot = async (e) => {
    e.preventDefault();
    try {
      const res = await callApi(() => api.post('/auth/forgot-password', { email }));
      setResetEmail(email);
      setPassword('');
      setCode('');
      setMode('verify-reset');
      showMessage(res.data.message, 'success');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  // Quên mật khẩu bước 2: xác nhận mã đúng + còn hạn mới cho sang bước đặt lại
  // (chỉ kiểm tra, chưa xóa mã — bước đặt lại sẽ kiểm tra lại mã này)
  const submitVerifyReset = async (e) => {
    e.preventDefault();
    try {
      const res = await callApi(() => api.post('/auth/verify-reset-code', { email: resetEmail, code }));
      setMode('reset');
      showMessage(res.data.message, 'success');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  // Quên mật khẩu bước 3: nhập mật khẩu mới → đổi xong về đăng nhập
  const submitReset = async (e) => {
    e.preventDefault();
    if (password.length < 6) {
      showMessage('Mật khẩu mới ít nhất 6 ký tự');
      return;
    }
    if (password !== confirmPassword) {
      showMessage('Mật khẩu mới nhập lại chưa khớp');
      return;
    }
    try {
      const res = await callApi(() => api.post('/auth/reset-password', { email: resetEmail, code, newPassword: password }));
      setUsername(resetEmail); // Đăng nhập chấp nhận cả Gmail nên điền sẵn cho tiện
      setMode('login');
      setCode('');
      setPassword('');
      setConfirmPassword('');
      showMessage(res.data.message, 'success');
    } catch (err) {
      // Lỗi ở bước này hầu hết là do mã (sai hoặc hết hạn) → quay lại bước xác nhận mã để gửi lại mã
      setMode('verify-reset');
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  const resendResetCode = async () => {
    try {
      const res = await callApi(() => api.post('/auth/forgot-password', { email: resetEmail }));
      showMessage(res.data.message, 'success');
    } catch (err) {
      showMessage(err.response?.data?.message || 'Có lỗi xảy ra');
    }
  };

  const passwordField = (id, autoComplete, fieldName, label = 'Mật khẩu') => (
    <div>
      <label className="auth-label" htmlFor={id}>{label}</label>
      <div className="auth-field">
        <IconLock />
        <input
          id={id}
          name={fieldName}
          className="auth-input"
          style={{ paddingRight: 38 }}
          type={showPassword ? 'text' : 'password'}
          autoComplete={autoComplete}
          placeholder="Nhập mật khẩu"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <button
          type="button"
          className="auth-eye"
          onClick={() => setShowPassword((v) => !v)}
          title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
        >
          {showPassword ? <IconEyeOff /> : <IconEye />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-deco auth-deco-1" />
          <div className="auth-deco auth-deco-2" />
          <div className="auth-deco auth-deco-3" />
          <img className="auth-logo" src="/logo.png" alt="KhoManager" />
          <h1>KhoManager</h1>
          <p className="auth-brand-tag">Theo dõi tồn kho, nhập xuất và cảnh báo thiếu hàng — tất cả trong một hệ thống duy nhất.</p>
          <div className="auth-features">
            <div className="auth-feature"><IconCheck /> Tồn kho cập nhật theo thời gian thực</div>
            <div className="auth-feature"><IconCheck /> Cảnh báo hết hàng, thiếu hàng, sắp hết hàng</div>
            <div className="auth-feature"><IconCheck /> Truy xuất nguồn gốc theo từng lot</div>
            <div className="auth-feature"><IconCheck /> Nhập liệu hàng loạt từ file Excel</div>
            <div className="auth-feature"><IconCheck /> Xuất kho trừ tồn theo nguyên tắc nhập trước – xuất trước</div>
            <div className="auth-feature"><IconCheck /> Mọi thao tác đều lưu vào lịch sử hoạt động</div>
          </div>
          <div className="auth-brand-note">
            <IconShield />
            <span>Tài khoản mới sau khi xác thực Gmail vẫn cần quản trị viên duyệt mới đăng nhập được.</span>
          </div>
        </div>

        <div className="auth-form">
          <h2 className="auth-form-title">
            {mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Đăng ký tài khoản' : mode === 'forgot' ? 'Quên mật khẩu' : mode === 'verify-reset' ? 'Xác nhận mã' : mode === 'reset' ? 'Đặt lại mật khẩu' : 'Xác thực Gmail'}
          </h2>
          <p className="auth-form-sub">
            {mode === 'login'
              ? 'Nhập tài khoản của bạn để tiếp tục.'
              : mode === 'register'
                ? 'Tạo tài khoản mới, mã xác thực sẽ gửi về Gmail.'
                : mode === 'forgot'
                  ? 'Nhập Gmail đã đăng ký, mã đặt lại mật khẩu sẽ gửi về Gmail.'
                  : mode === 'verify-reset'
                    ? 'Nhập mã 6 số đã gửi về Gmail của bạn.'
                    : mode === 'reset'
                      ? 'Nhập mật khẩu mới.'
                      : 'Nhập mã 6 số đã gửi về Gmail của bạn.'}
          </p>

          {['login', 'register'].includes(mode) && (
            <div className="auth-tabs">
              <button type="button" className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => switchMode('login')}>
                Đăng nhập
              </button>
              <button type="button" className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => switchMode('register')}>
                Đăng ký
              </button>
            </div>
          )}

          {mode === 'login' && (
            <form className="auth-form-stack" onSubmit={submitLogin}>
              <div>
                <label className="auth-label" htmlFor="login-user">Tên đăng nhập hoặc Gmail</label>
                <div className="auth-field">
                  <IconUser />
                  <input id="login-user" name="username" className="auth-input" autoComplete="username" placeholder="Nhập tài khoản của bạn" value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
              </div>
              {passwordField('login-pass', 'current-password', 'password')}
              <label className="auth-remember">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                Ghi nhớ đăng nhập
              </label>
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang đăng nhập...</>) : 'Đăng nhập'}</button>
              <div className="auth-center">
                <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>Quên mật khẩu?</button>
              </div>
            </form>
          )}

          {mode === 'register' && (
            <form className="auth-form-stack" onSubmit={submitRegister}>
              <div>
                <label className="auth-label" htmlFor="reg-user">Tên đăng nhập</label>
                <div className="auth-field">
                  <IconUser />
                  <input id="reg-user" name="username" className="auth-input" autoComplete="username" placeholder="Nhập tên đăng nhập" value={username} onChange={(e) => setUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="auth-label" htmlFor="reg-email">Gmail</label>
                <div className="auth-field">
                  <IconMail />
                  <input id="reg-email" name="email" className="auth-input" type="email" autoComplete="email" placeholder="ten@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              </div>
              {passwordField('reg-pass', 'new-password', 'new-password')}
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang đăng ký...</>) : 'Đăng ký'}</button>
              <p className="auth-note">Sau khi đăng ký, mã xác thực 6 số sẽ được gửi vào Gmail của bạn.</p>
            </form>
          )}

          {mode === 'forgot' && (
            <form className="auth-form-stack" onSubmit={submitForgot}>
              <div>
                <label className="auth-label" htmlFor="forgot-email">Gmail</label>
                <div className="auth-field">
                  <IconMail />
                  <input id="forgot-email" name="email" className="auth-input" type="email" autoComplete="email" placeholder="ten@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                </div>
              </div>
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang gửi...</>) : 'Gửi mã'}</button>
              <div className="auth-center">
                <button type="button" className="auth-link" onClick={() => switchMode('login')}>Quay lại đăng nhập</button>
              </div>
            </form>
          )}

          {mode === 'verify-reset' && (
            <form className="auth-form-stack" onSubmit={submitVerifyReset}>
              <p className="auth-verify-info">
                Mã đặt lại mật khẩu đã gửi vào Gmail <b>{resetEmail}</b>. Mã có hiệu lực trong 1 phút.
              </p>
              <div>
                <label className="auth-label" htmlFor="reset-code">Mã đặt lại mật khẩu</label>
                <div className="auth-field">
                  <IconShield />
                  <input
                    id="reset-code"
                    className="auth-input"
                    style={{ textAlign: 'center', letterSpacing: 4, fontSize: 18 }}
                    autoComplete="one-time-code"
                    name="code"
                    placeholder="Nhập mã 6 số"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang xác nhận...</>) : 'Xác nhận mã'}</button>
              <button type="button" className="auth-submit auth-submit-secondary" onClick={resendResetCode} disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang gửi...</>) : 'Gửi lại mã'}</button>
              <div className="auth-center">
                <button type="button" className="auth-link" onClick={() => switchMode('forgot')}>Dùng Gmail khác</button>
                {' · '}
                <button type="button" className="auth-link" onClick={() => switchMode('login')}>Quay lại đăng nhập</button>
              </div>
            </form>
          )}

          {mode === 'reset' && (
            <form className="auth-form-stack" onSubmit={submitReset}>
              <p className="auth-verify-info">
                Mã đã xác nhận. Nhập mật khẩu mới cho Gmail <b>{resetEmail}</b>.
              </p>
              {passwordField('reset-pass', 'new-password', 'new-password', 'Mật khẩu mới')}
              <div>
                <label className="auth-label" htmlFor="reset-confirm">Nhập lại mật khẩu mới</label>
                <div className="auth-field">
                  <IconLock />
                  <input id="reset-confirm" name="new-password-confirm" className="auth-input" style={{ paddingRight: 38 }} type={showPassword ? 'text' : 'password'} autoComplete="new-password" placeholder="Nhập lại mật khẩu mới" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                  <button type="button" className="auth-eye" onClick={() => setShowPassword((v) => !v)} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}>
                    {showPassword ? <IconEyeOff /> : <IconEye />}
                  </button>
                </div>
              </div>
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang đặt lại...</>) : 'Đặt lại mật khẩu'}</button>
              <div className="auth-center">
                <button type="button" className="auth-link" onClick={() => switchMode('login')}>Quay lại đăng nhập</button>
              </div>
            </form>
          )}

          {mode === 'verify' && (
            <form className="auth-form-stack" onSubmit={submitVerify}>
              <p className="auth-verify-info">
                Mã xác thực đã gửi vào Gmail của tài khoản <b>{verifyUsername}</b>. Mã có hiệu lực trong 15 phút.
              </p>
              <div>
                <label className="auth-label" htmlFor="verify-user">Tên đăng nhập</label>
                <div className="auth-field">
                  <IconUser />
                  <input id="verify-user" name="username" className="auth-input" autoComplete="username" placeholder="Nhập tên đăng nhập" value={verifyUsername} onChange={(e) => setVerifyUsername(e.target.value)} required />
                </div>
              </div>
              <div>
                <label className="auth-label" htmlFor="verify-code">Mã xác thực</label>
                <div className="auth-field">
                  <IconShield />
                  <input
                    id="verify-code"
                    className="auth-input"
                    style={{ textAlign: 'center', letterSpacing: 4, fontSize: 18 }}
                    autoComplete="one-time-code"
                    name="code"
                    placeholder="Nhập mã 6 số"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    required
                  />
                </div>
              </div>
              <button type="submit" className="auth-submit" disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang xác thực...</>) : 'Xác thực'}</button>
              <button type="button" className="auth-submit auth-submit-secondary" onClick={resendCode} disabled={loading}>{loading ? (<><span className="auth-spinner" /> Đang gửi...</>) : 'Gửi lại mã'}</button>
              <div className="auth-center">
                <button type="button" className="auth-link" onClick={() => switchMode('login')}>Quay lại đăng nhập</button>
              </div>
            </form>
          )}

          {message && (
            <p className={`auth-msg ${messageType}`}>{message}</p>
          )}
          <p className="auth-foot">© 2026 KhoManager</p>
        </div>
      </div>
    </div>
  );
}
