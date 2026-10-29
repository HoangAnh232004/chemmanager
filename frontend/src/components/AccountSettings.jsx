import { useState } from 'react';
import api from '../api';
import { maskEmail } from '../utils';
import './AccountSettings.css';

// Modal Cài đặt tài khoản: xem thông tin tài khoản và đổi mật khẩu.
// Mở từ nút "Cài đặt tài khoản" trong menu tài khoản (kiểu menu FB).

export default function AccountSettings({ user, onClose }) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Vui lòng nhập đủ 3 ô mật khẩu');
      return;
    }
    if (newPassword.length < 6) {
      setError('Mật khẩu mới ít nhất 6 ký tự');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu mới nhập lại chưa khớp');
      return;
    }
    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'Đổi mật khẩu thất bại');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="settings-backdrop" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <b>Cài đặt tài khoản</b>
          <button className="settings-close" onClick={onClose}>✕</button>
        </div>
        <div className="settings-row"><span>Tên đăng nhập</span><b>{user.username}</b></div>
        <div className="settings-row"><span>Gmail</span><b>{maskEmail(user.email)}</b></div>
        <div className="settings-row"><span>Vai trò</span><b>{user.role === 'admin' ? 'Quản trị viên' : 'Người dùng'}</b></div>
        <hr className="settings-divider" />
        {done ? (
          <div className="settings-done">
            <p>Đã đổi mật khẩu. Bạn vẫn giữ đăng nhập, không cần đăng nhập lại.</p>
            <button className="settings-save" onClick={onClose}>Xong</button>
          </div>
        ) : (
          <form onSubmit={submit} className="settings-form">
            <h3>Đổi mật khẩu</h3>
            <label>Mật khẩu hiện tại
              <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
            </label>
            <label>Mật khẩu mới (ít nhất 6 ký tự)
              <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
            </label>
            <label>Nhập lại mật khẩu mới
              <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" />
            </label>
            {error && <div className="settings-error">{error}</div>}
            <div className="settings-actions">
              <button type="button" className="settings-cancel" onClick={onClose}>Hủy</button>
              <button type="submit" className="settings-save" disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu thay đổi'}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
