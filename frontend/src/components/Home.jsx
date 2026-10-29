import { useState, useEffect } from 'react';
import api from '../api';
import './Home.css';

// Trang chủ theo giao diện demo đã chốt: chỉ đổi bố cục/hiển thị,
// toàn bộ logic lấy số liệu và luật cảnh báo giữ nguyên như bản cũ.

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Icon SVG nét mảnh trong ô vuông bo tròn (kiểu icon của demo, không dùng emoji)
function Icon({ tone, children }) {
  return (
    <span className={`hm-ic${tone ? ` ${tone}` : ''}`}>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
    </span>
  );
}

export default function Home({ signal, user, goTab }) {
  const [chemicals, setChemicals] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lots, setLots] = useState([]);
  const [exports, setExports] = useState([]);
  const [pending, setPending] = useState([]);
  const isAdmin = user?.role === 'admin';

  const load = async () => {
    const [c, i, l, e, p] = await Promise.all([
      api.get('/chemicals').catch(() => ({ data: [] })),
      api.get('/inventory').catch(() => ({ data: [] })),
      api.get('/lots').catch(() => ({ data: [] })),
      api.get('/lots/exports').catch(() => ({ data: [] })),
      isAdmin ? api.get('/auth/pending').catch(() => ({ data: [] })) : Promise.resolve({ data: [] }),
    ]);
    setChemicals(c.data); setInventory(i.data); setLots(l.data); setExports(e.data); setPending(p.data);
  };

  useEffect(() => { load(); }, [signal]);

  // Tổng tồn theo từng hóa chất
  const totals = {};
  inventory.forEach((i) => {
    totals[i.chemical_name] = (totals[i.chemical_name] || 0) + (Number(i.quantity_available) || 0);
  });

  // Cảnh báo — đúng luật cột Trạng thái ở tab Kho: tồn = 0 → Hết hàng,
  // tồn vượt tối thiểu không quá 20% → Đặt hàng, còn lại không vào danh sách này
  const chemInfo = {};
  chemicals.forEach((c) => { chemInfo[c.name] = c; });
  const rank = { 'Hết hàng': 0, 'Đặt hàng': 1 };
  const alerts = Object.keys(totals).map((name) => {
    const total = totals[name];
    const minStock = Number(chemInfo[name]?.min_stock) || 0;
    const status = total === 0 ? 'Hết hàng' : (total <= minStock * 1.2 ? 'Đặt hàng' : '');
    return { name, total, status };
  }).filter((a) => a.status).sort((a, b) => rank[a.status] - rank[b.status]);

  // Nhập / xuất trong ngày (ngày trên máy): nhập = lot có Ngày nhập hôm nay, xuất = lần xuất hôm nay.
  // Lưu ý: bảng lots KHÔNG có cột created_at nên không lọc theo created_at được —
  // phải lọc theo received_date (chính là cột "Ngày nhập" ở tab Mua/nhập).
  const today = todayStr();
  const importsToday = lots
    .filter((l) => String(l.received_date || l.created_at || '').slice(0, 10) === today)
    .map((l) => {
      const t = String(l.created_at || '').slice(11, 16);
      return { time: /^\d{2}:\d{2}$/.test(t) ? t : '', name: l.chemical_name || 'Không tên', qty: Number(l.quantity) || 0 };
    })
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const exportsToday = exports
    .filter((x) => String(x.export_date || '').slice(0, 10) === today)
    .map((x) => ({ time: '', name: x.chemical_name || 'Không tên', qty: Number(x.quantity) || 0 }));

  return (
    <div className="hm-home">
      <div className="hm-kpis">
        <div className="hm-kpi">
          <b>{importsToday.length}</b><span>Lượt nhập hôm nay</span>
        </div>
        <div className="hm-kpi">
          <b>{exportsToday.length}</b><span>Lượt xuất hôm nay</span>
        </div>
        <div className="hm-kpi warn">
          <b>{alerts.length}</b><span>Cảnh báo tồn kho</span>
        </div>
        {isAdmin && (
          <div className="hm-kpi">
            <b>{pending.length}</b><span>Tài khoản chờ duyệt</span>
          </div>
        )}
      </div>

      <div className="hm-groups">
        <section className="hm-group">
          <h3>Vận hành kho hằng ngày</h3>
          <div className="hm-tiles">
            <button type="button" className="hm-tile" onClick={() => goTab('lots')}><Icon><path d="M12 5v14M5 12h14" /></Icon><b>Nhập kho</b><small>Thêm lot mới, nhập file Excel</small></button>
            <button type="button" className="hm-tile" onClick={() => goTab('export')}><Icon tone="orange"><path d="M5 12h14" /></Icon><b>Xuất kho</b><small>Trừ tồn theo FIFO</small></button>
            <button type="button" className="hm-tile" onClick={() => goTab('inventory')}><Icon><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></Icon><b>Xem kho</b><small>{chemicals.length} hóa chất đang lưu kho</small></button>
          </div>
        </section>

        <section className="hm-group">
          <h3>Danh mục &amp; nhập liệu</h3>
          <div className="hm-tiles">
            <button type="button" className="hm-tile" onClick={() => goTab('chemicals')}><Icon><path d="M10 2v6.5L4.5 19a2 2 0 0 0 1.8 3h11.4a2 2 0 0 0 1.8-3L14 8.5V2" /><path d="M8.5 2h7" /><path d="M7 15h10" /></Icon><b>Hóa chất</b><small>Danh mục hóa chất</small></button>
            <button type="button" className="hm-tile" onClick={() => goTab('suppliers')}><Icon><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon><b>Nhà cung cấp</b><small>Danh mục nhà cung cấp</small></button>
            {isAdmin && (
              <button type="button" className="hm-tile" onClick={() => goTab('import')}><Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M9 13h6M9 17h6" /></Icon><b>Nhập Excel</b><small>Nhập file STOCK LIST</small></button>
            )}
          </div>
        </section>

        <section className="hm-group">
          <h3>Theo dõi &amp; quản trị</h3>
          <div className="hm-tiles">
            <button type="button" className="hm-tile" onClick={() => goTab('inventory')}>
              <Icon tone="red"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4" /><path d="M12 17h.01" /></Icon>
              <b>Cảnh báo tồn kho</b><small>{alerts.length ? `${alerts.length} mục cần chú ý ngay` : 'Kho đang ổn định'}</small>
              {alerts.length > 0 && <span className="hm-badge">{alerts.length}</span>}
            </button>
            <button type="button" className="hm-tile" onClick={() => goTab('archive')}><Icon><path d="M12 20V10" /><path d="M18 20V4" /><path d="M6 20v-6" /></Icon><b>Báo cáo &amp; Lưu trữ</b><small>Xuất PDF tồn kho tháng</small></button>
            {isAdmin && (
              <button type="button" className="hm-tile" onClick={() => goTab('audit')}><Icon><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></Icon><b>Lịch sử hoạt động</b><small>Xem ai đã làm gì</small></button>
            )}
            {isAdmin && (
              <button type="button" className="hm-tile" onClick={() => goTab('approvals')}>
                <Icon><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /><path d="M16 11l2 2 4-4" /></Icon>
                <b>Duyệt tài khoản</b><small>{pending.length ? `${pending.length} tài khoản chờ duyệt` : 'Không có tài khoản chờ'}</small>
                {pending.length > 0 && <span className="hm-badge">{pending.length}</span>}
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
