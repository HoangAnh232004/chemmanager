import { useState } from 'react';
import api from '../api';
import './NotificationDetail.css';

// Bảng nổi mở ra khi bấm vào 1 thông báo: hiện thẳng đúng thứ đang được báo.
// - Báo hết hàng / cần đặt hàng → chi tiết hóa chất đó (tồn hiện tại, tối thiểu,
//   số lượng đặt hàng, tên Hàn, quy cách) + nút sang tab Kho.
// - Tài khoản chờ duyệt → thông tin tài khoản + duyệt / từ chối ngay tại chỗ.

export default function NotificationDetail({ detail, onClose, onGoKho, onReload }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!detail) return null;

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      onReload();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Thao tác thất bại');
    } finally {
      setBusy(false);
    }
  };

  const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');

  if (detail.type === 'pending') {
    return (
      <div className="nd-backdrop" onClick={onClose}>
        <div className="nd-modal" onClick={(e) => e.stopPropagation()}>
          <div className="nd-head">
            <b>Tài khoản chờ duyệt</b>
            <button className="nd-close" onClick={onClose}>✕</button>
          </div>
          <div className="nd-row"><span>Tên đăng nhập</span><b>{detail.username}</b></div>
          <div className="nd-row"><span>Ngày đăng ký</span><b>{fmtDate(detail.date)}</b></div>
          {error && <div className="nd-error">{error}</div>}
          <div className="nd-actions">
            <button className="nd-btn-neutral" onClick={onClose} disabled={busy}>Đóng</button>
            <button className="nd-btn-danger" onClick={() => act(() => api.delete(`/auth/reject/${detail.id}`))} disabled={busy}>Từ chối</button>
            <button className="nd-btn-primary" onClick={() => act(() => api.put(`/auth/approve/${detail.id}`))} disabled={busy}>{busy ? 'Đang xử lý...' : 'Duyệt'}</button>
          </div>
        </div>
      </div>
    );
  }

  const badgeClass = detail.status === 'Hết hàng' ? 'out' : 'order';
  // Số lượng nên đặt = Tối đa − Tồn hiện tại (đặt thêm cho đủ mức tối đa);
  // chưa đặt Tối đa thì không tính được, hiện gạch ngang.
  const orderSuggest = detail.orderQty > 0
    ? Math.round(Math.max(0, detail.orderQty - detail.total) * 100) / 100
    : null;
  return (
    <div className="nd-backdrop" onClick={onClose}>
      <div className="nd-modal" onClick={(e) => e.stopPropagation()}>
        <div className="nd-head">
          <b>{detail.name}</b>
          <button className="nd-close" onClick={onClose}>✕</button>
        </div>
        <span className={`nd-badge ${badgeClass}`}>{detail.status}</span>
        <div className="nd-row"><span>Tên Hàn</span><b>{detail.koreanName || '—'}</b></div>
        <div className="nd-row"><span>Quy cách</span><b>{detail.packaging || '—'}</b></div>
        <div className="nd-row"><span>Tồn hiện tại</span><b className={`nd-stock ${badgeClass}`}>{detail.total} kg</b></div>
        <div className="nd-row"><span>Tồn tối thiểu</span><b>{detail.min} kg</b></div>
        <div className="nd-row"><span>Số lượng đặt hàng</span><b>{orderSuggest !== null ? `${orderSuggest} kg` : '—'}</b></div>
        <div className="nd-actions">
          <button className="nd-btn-neutral" onClick={onClose}>Đóng</button>
          <button className="nd-btn-primary" onClick={() => { onClose(); onGoKho(detail.name); }}>Xem ở tab Kho</button>
        </div>
      </div>
    </div>
  );
}
