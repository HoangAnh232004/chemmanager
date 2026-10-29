import { useState, useEffect, useRef } from 'react';
import api from '../api';
import './Home.css';

// Trang chủ theo giao diện demo đã chốt: chỉ đổi bố cục/hiển thị,
// toàn bộ logic lấy số liệu và luật cảnh báo giữ nguyên như bản cũ.
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Bảng chạy dọc: danh sách lặp 2 lần để cuộn vòng liên tục, rê chuột vào thì dừng
function Ticker({ rows, emptyText, duration }) {
  if (!rows.length) return <div className="hm-ticker-empty">{emptyText}</div>;
  const track = [...rows, ...rows];
  return (
    <div className="hm-ticker">
      <div className="hm-ticker-track" style={{ animationDuration: `${duration}s` }}>
        {track.map((r, i) => (
          <div key={i} className="hm-trow">
            <span className="hm-trow-name">{r.time ? `${r.time} · ` : ''}{r.name}</span>
            <span className="hm-trow-qty">{Number(r.qty).toLocaleString('vi-VN')} kg</span>
          </div>
        ))}
      </div>
    </div>
  );
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
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
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

  // Nhập / xuất trong ngày (ngày trên máy): nhập = lot tạo hôm nay, xuất = lần xuất hôm nay
  const today = todayStr();
  const importsToday = lots
    .filter((l) => String(l.created_at || '').slice(0, 10) === today)
    .map((l) => {
      const t = String(l.created_at || '').slice(11, 16);
      return { time: /^\d{2}:\d{2}$/.test(t) ? t : '', name: l.chemical_name || 'Không tên', qty: Number(l.quantity) || 0 };
    })
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0));
  const totalIn = importsToday.reduce((s, r) => s + r.qty, 0);
  const exportsToday = exports
    .filter((x) => String(x.export_date || '').slice(0, 10) === today)
    .map((x) => ({ time: '', name: x.chemical_name || 'Không tên', qty: Number(x.quantity) || 0 }));
  const totalOut = exportsToday.reduce((s, r) => s + r.qty, 0);

  // Tìm kiếm nhanh: lọc hóa chất không phân biệt dấu, bấm vào thì sang tab Kho
  const q = normalize(query);
  const searchResults = q ? chemicals.filter((c) => normalize(c.name).includes(q)).slice(0, 6) : [];

  return (
    <div className="hm-home">
      <div className="hm-search">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') goTab('inventory'); }}
          placeholder="Tìm hóa chất... (gõ không dấu vẫn tìm được, ví dụ: aceton)"
        />
        {searchResults.length > 0 && (
          <div className="hm-results">
            {searchResults.map((c) => (
              <div key={c.id} className="hm-result" onClick={() => goTab('inventory')}>
                <span>{c.name}</span>
                <span className="hm-result-stock">Tồn {(totals[c.name] || 0).toLocaleString('vi-VN')} kg</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="hm-kpis">
        <button type="button" className="hm-kpi" onClick={() => goTab('lots')}>
          <b>{importsToday.length}</b><span>Lượt nhập hôm nay</span>
        </button>
        <button type="button" className="hm-kpi" onClick={() => goTab('export')}>
          <b>{exportsToday.length}</b><span>Lượt xuất hôm nay</span>
        </button>
        <button type="button" className="hm-kpi warn" onClick={() => goTab('inventory')}>
          <b>{alerts.length}</b><span>Cảnh báo tồn kho</span>
        </button>
        {isAdmin && (
          <button type="button" className="hm-kpi" onClick={() => goTab('approvals')}>
            <b>{pending.length}</b><span>Tài khoản chờ duyệt</span>
          </button>
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
            <button type="button" className="hm-tile" onClick={() => searchRef.current?.focus()}><Icon><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></Icon><b>Tìm kiếm</b><small>Tìm nhanh theo tên hóa chất</small></button>
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

      <div className="hm-today">
        <div className="hm-ticker-wrap in">
          <div className="hm-ticker-head"><b>↑ Nhập hôm nay</b><span>{totalIn.toLocaleString('vi-VN')} kg</span></div>
          <Ticker rows={importsToday} emptyText="Hôm nay chưa có nhập kho." duration={Math.max(6, importsToday.length * 3)} />
        </div>
        <div className="hm-ticker-wrap out">
          <div className="hm-ticker-head"><b>↓ Xuất hôm nay</b><span>{totalOut.toLocaleString('vi-VN')} kg</span></div>
          <Ticker rows={exportsToday} emptyText="Hôm nay chưa có xuất kho." duration={Math.max(6, exportsToday.length * 3) + 3} />
        </div>
      </div>
    </div>
  );
}
