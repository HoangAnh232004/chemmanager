import { useState, useEffect } from 'react';
import api from '../api';
import './Notifications.css';

// Chuông thông báo ở header: báo hết hàng / cần đặt hàng (theo đúng luật
// cột Trạng thái ở tab Kho) và tài khoản chờ duyệt (chỉ admin thấy).
// Huy hiệu = số thông báo chưa xem; bấm vào 1 thông báo thì đi thẳng tới
// đúng chỗ của nó (báo tồn → tab Kho đúng hóa chất đó, chờ duyệt → tab
// Duyệt tài khoản) và tính là đã đọc nên huy hiệu trừ đi 1.
// Chuông vẽ bằng SVG cho nét, khớp tông xanh ngọc của web (không dùng emoji).

const SEEN_KEY = 'notifSeen';

function loadSeen() {
  try {
    return JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function Notifications({ user, signal, goTab, goKho }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [seen, setSeen] = useState(loadSeen);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    const [c, i] = await Promise.all([
      api.get('/chemicals').catch(() => ({ data: [] })),
      api.get('/inventory').catch(() => ({ data: [] })),
    ]);
    const chemInfo = {};
    (c.data || []).forEach((ch) => { chemInfo[ch.name] = ch; });
    const totals = {};
    (i.data || []).forEach((row) => {
      totals[row.chemical_name] = (totals[row.chemical_name] || 0) + (Number(row.quantity_available) || 0);
    });
    const list = [];
    Object.keys(totals).forEach((name) => {
      const total = totals[name];
      const min = Number(chemInfo[name]?.min_stock) || 0;
      // Cùng luật tab Kho: tồn <= 0 → Hết hàng; tồn <= tối thiểu x 1.2 → Đặt hàng
      // (tối thiểu = 0 mà còn tồn thì không báo)
      const status = total <= 0 ? 'Hết hàng' : (total <= min * 1.2 ? 'Đặt hàng' : '');
      if (!status) return;
      list.push({
        id: `stock-${name}-${status}`,
        kind: status,
        title: `${status}: ${name}`,
        detail: `Tồn hiện tại: ${Number(total)} kg`,
        tab: 'inventory',
        name,
      });
    });
    const rank = { 'Hết hàng': 0, 'Đặt hàng': 1 };
    list.sort((a, b) => rank[a.kind] - rank[b.kind]);
    if (isAdmin) {
      const p = await api.get('/auth/pending').catch(() => ({ data: [] }));
      (p.data || []).forEach((u) => {
        const d = String(u.created_at || '').slice(0, 10);
        list.push({
          id: `pending-${u.id}`,
          kind: 'Chờ duyệt',
          title: `Tài khoản chờ duyệt: ${u.username}`,
          detail: d ? `Đăng ký ngày ${d.split('-').reverse().join('/')}` : '',
          tab: 'approvals',
        });
      });
    }
    setItems(list);
  };

  useEffect(() => {
    load();
  }, [signal, isAdmin]);

  const seenSet = new Set(seen);
  const unreadCount = items.filter((it) => !seenSet.has(it.id)).length;

  const toggleOpen = () => {
    if (!open) {
      load();
    }
    setOpen(!open);
  };

  // Bấm vào 1 thông báo thì đi thẳng tới đúng chỗ của nó, không mở bảng nổi
  // chi tiết nữa: báo tồn → tab Kho đúng hóa chất đó (nháy vàng 1 lần);
  // chờ duyệt → tab Duyệt tài khoản. Bấm vào cũng tính là đã đọc nên huy
  // hiệu trừ đi 1.
  const goTo = (it) => {
    setOpen(false);
    if (!seenSet.has(it.id)) {
      const next = [...seen, it.id];
      setSeen(next);
      localStorage.setItem(SEEN_KEY, JSON.stringify(next));
    }
    if (it.tab === 'inventory') goKho(it.name);
    else goTab(it.tab);
  };

  const dotClass = (kind) => kind === 'Hết hàng' ? 'out' : kind === 'Đặt hàng' ? 'order' : 'pending';

  return (
    <div className="notif-wrap">
      <button className="notif-btn" onClick={toggleOpen} title="Thông báo">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unreadCount > 0 && (
          <span className="notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>
        )}
      </button>
      {open && (
        <>
          <div className="notif-backdrop" onClick={() => setOpen(false)} />
          <div className="notif-panel">
            <div className="notif-panel-head">
              <b>Thông báo</b>
            </div>
            {items.length === 0 ? (
              <div className="notif-empty">Không có thông báo mới.</div>
            ) : (
              <div className="notif-list">
                {items.map((it) => (
                  <button
                    key={it.id}
                    className={seenSet.has(it.id) ? 'notif-item' : 'notif-item unread'}
                    onClick={() => goTo(it)}
                  >
                    <span className={`notif-dot ${dotClass(it.kind)}`} />
                    <span>
                      <span className="notif-item-title">{it.title}</span>
                      {it.detail && <span className="notif-item-detail">{it.detail}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
