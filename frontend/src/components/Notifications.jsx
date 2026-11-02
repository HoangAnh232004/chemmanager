import { useState, useEffect } from 'react';
import api from '../api';
import './Notifications.css';

// Chuông thông báo ở header: báo hết hàng / cần đặt hàng (theo đúng luật
// cột Trạng thái ở tab Kho) và tài khoản chờ duyệt (chỉ admin thấy).
// Huy hiệu = số thông báo chưa xem; bấm vào 1 thông báo thì đi thẳng tới
// đúng chỗ của nó (báo tồn → tab Kho đúng hóa chất đó, chờ duyệt → tab
// Duyệt tài khoản) và tính là đã đọc nên huy hiệu trừ đi 1.
// Chữ "Đánh dấu đã đọc" luôn hiện ở đầu bảng, bấm là đọc hết 1 lần.
// Vị trí trong bảng KHÔNG đổi theo đã đọc hay chưa: chỉ thông báo mới xuất
// hiện lần đầu mới lên đầu bảng, thông báo đã có giữ nguyên vị trí ban đầu.
// Thứ tự này lưu ở localStorage (notifOrder) nên F5 vẫn giữ nguyên.
// Chuông vẽ bằng SVG cho nét, khớp tông xanh ngọc của web (không dùng emoji).

const SEEN_KEY = 'notifSeen';
const ORDER_KEY = 'notifOrder';
// Thứ tự loại trong cùng nhóm đọc: Hết hàng trước Đặt hàng, chờ duyệt sau cùng.
const KIND_RANK = { 'Hết hàng': 0, 'Đặt hàng': 1, 'Chờ duyệt': 2 };

function loadOrder() {
  try {
    const v = JSON.parse(localStorage.getItem(ORDER_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

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
  const [order, setOrder] = useState(loadOrder);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    const [m, p] = await Promise.all([
      api.get('/monthly/current').catch(() => ({ data: null })),
      isAdmin ? api.get('/auth/pending').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);
    const list = [];
    // Cùng luật tab Kho, lấy từ /monthly/current thay vì tải toàn bộ tồn kho:
    // tồn <= 0 → Hết hàng; tồn <= tối thiểu x 1.2 → Đặt hàng
    // (tối thiểu = 0 mà còn tồn thì không báo)
    (m.data?.rows || []).forEach((r) => {
      const total = Number(r.closing) || 0;
      const min = Number(r.min_stock) || 0;
      const status = total <= 0 ? 'Hết hàng' : (total <= min * 1.2 ? 'Đặt hàng' : '');
      if (!status) return;
      list.push({
        id: `stock-${r.chemical_name}-${status}`,
        kind: status,
        title: `${status}: ${r.chemical_name}`,
        detail: `Tồn hiện tại: ${Number(total)} kg`,
        tab: 'inventory',
        name: r.chemical_name,
      });
    });
    if (isAdmin) {
      (p.data || []).forEach((u) => {
        const d = String(u.created_at || '').slice(0, 10);
        list.push({
          id: `pending-${u.id}`,
          kind: 'Chờ duyệt',
          title: `Tài khoản chờ duyệt: ${u.username}`,
          detail: d ? `Đăng ký ngày ${d.split('-').reverse().join('/')}` : '',
          created_at: u.created_at || '',
          tab: 'approvals',
        });
      });
    }
    // Thứ tự cơ sở cho những thông báo mới xuất hiện: Hết hàng trước Đặt hàng,
    // chờ duyệt mới đăng ký trước.
    list.sort((a, b) => {
      if (a.kind === 'Chờ duyệt' && b.kind === 'Chờ duyệt') {
        return (b.created_at || '').localeCompare(a.created_at || '');
      }
      return KIND_RANK[a.kind] - KIND_RANK[b.kind];
    });
    // Vị trí ổn định: chỉ thông báo mới xuất hiện lần đầu mới lên đầu bảng,
    // thông báo đã có từ trước giữ nguyên vị trí ban đầu (đọc hay chưa đọc
    // cũng không nhảy vị trí). Thứ tự này lưu ở localStorage nên F5 vẫn giữ.
    const prevOrder = loadOrder();
    const prevSet = new Set(prevOrder);
    const currentIds = new Set(list.map((it) => it.id));
    const nextOrder = [
      ...list.filter((it) => !prevSet.has(it.id)).map((it) => it.id),
      ...prevOrder.filter((id) => currentIds.has(id)),
    ];
    localStorage.setItem(ORDER_KEY, JSON.stringify(nextOrder));
    setOrder(nextOrder);
    setItems(list);
  };

  useEffect(() => {
    load();
  }, [signal, isAdmin]);

  const seenSet = new Set(seen);
  const unreadCount = items.filter((it) => !seenSet.has(it.id)).length;

  // Hiển thị theo thứ tự đã lưu: mới lên đầu, cũ giữ nguyên vị trí.
  const orderIndex = new Map(order.map((id, i) => [id, i]));
  const sortedItems = [...items].sort((a, b) => (orderIndex.get(a.id) ?? Infinity) - (orderIndex.get(b.id) ?? Infinity));

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

  // Chữ "Đánh dấu đã đọc" ở đầu bảng: đánh dấu tất cả thông báo đang hiện
  // là đã đọc nên huy hiệu về 0, bảng vẫn mở để xem tiếp. Thông báo mới
  // xuất hiện sau đó (id chưa có trong danh sách đã đọc) vẫn hiện là chưa đọc.
  const markAllRead = () => {
    const next = [...seen];
    items.forEach((it) => { if (!seenSet.has(it.id)) next.push(it.id); });
    setSeen(next);
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  };

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
              <button type="button" className="notif-mark-read" onClick={markAllRead}>Đánh dấu đã đọc</button>
            </div>
            {items.length === 0 ? (
              <div className="notif-empty">Không có thông báo mới.</div>
            ) : (
              <div className="notif-list">
                {sortedItems.map((it) => (
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
