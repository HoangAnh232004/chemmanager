import { useState, useEffect, useRef } from 'react';
import api from '../api';
import './Home.css';

// Trang chủ kiểu kiosk cảm ứng (kiểu 36): đồng hồ live, ô tìm kiếm lớn,
// 6 ô bấm to dẫn tới đúng tab, 2 bảng chạy nhập/xuất trong ngày lấy số liệu thật,
// dải cảnh báo và hoạt động gần đây. Thanh ngang và menu dọc vẫn giữ nguyên.
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Bảng chạy dọc: danh sách lặp 2 lần để cuộn vòng liên tục, rê chuột vào thì dừng
function Ticker({ rows, emptyText, duration }) {
  if (!rows.length) return <div className="kiosk-ticker-empty">{emptyText}</div>;
  const track = [...rows, ...rows];
  return (
    <div className="kiosk-ticker">
      <div className="kiosk-ticker-track" style={{ animationDuration: `${duration}s` }}>
        {track.map((r, i) => (
          <div key={i} className="kiosk-trow">
            <span className="kiosk-trow-name">{r.time ? `${r.time} · ` : ''}{r.name}</span>
            <span className="kiosk-trow-qty">{Number(r.qty).toLocaleString('vi-VN')} kg</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home({ signal, user, goTab }) {
  const [chemicals, setChemicals] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [lots, setLots] = useState([]);
  const [exports, setExports] = useState([]);
  const [activities, setActivities] = useState([]);
  const [now, setNow] = useState(new Date());
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);

  const load = async () => {
    const [c, i, l, e, a] = await Promise.all([
      api.get('/chemicals').catch(() => ({ data: [] })),
      api.get('/inventory').catch(() => ({ data: [] })),
      api.get('/lots').catch(() => ({ data: [] })),
      api.get('/lots/exports').catch(() => ({ data: [] })),
      api.get('/audit').catch(() => ({ data: [] })),
    ]);
    setChemicals(c.data); setInventory(i.data); setLots(l.data); setExports(e.data); setActivities(a.data);
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Đồng hồ live mỗi giây
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // Tổng tồn theo từng hóa chất (API tồn kho đã trả kèm tên hóa chất)
  const totals = {};
  inventory.forEach((i) => {
    totals[i.chemical_name] = (totals[i.chemical_name] || 0) + (Number(i.quantity_available) || 0);
  });
  const totalStock = Object.values(totals).reduce((sum, v) => sum + v, 0);

  // Hóa chất cần chú ý — cùng luật với cột Trạng thái ở tab Kho: tồn = 0 → Hết hàng,
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

  const clockLabel = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' — ' + now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  // Tìm kiếm nhanh: lọc hóa chất không phân biệt dấu, bấm vào thì sang tab Kho
  const q = normalize(query);
  const searchResults = q ? chemicals.filter((c) => normalize(c.name).includes(q)).slice(0, 6) : [];
  const recent = activities.slice(0, 4);

  return (
    <div className="kiosk-home">
      <div className="kiosk-clock">{clockLabel}</div>

      <div className="kiosk-search">
        <input
          ref={searchRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') goTab('inventory'); }}
          placeholder="Tìm hóa chất, nhà cung cấp, mã lot..."
        />
        <button type="button" className="kiosk-scan" onClick={() => searchRef.current?.focus()}>Quét mã</button>
        {searchResults.length > 0 && (
          <div className="kiosk-results">
            {searchResults.map((c) => (
              <div key={c.id} className="kiosk-result" onClick={() => goTab('inventory')}>
                <span>{c.name}</span>
                <span className="kiosk-result-stock">Tồn {(totals[c.name] || 0).toLocaleString('vi-VN')} kg</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="kiosk-tiles">
        <button type="button" className="kiosk-tile" onClick={() => goTab('lots')}>
          <span className="kiosk-sym green">+</span><b>NHẬP KHO</b><small>Thêm lot mới, nhập file Excel</small>
        </button>
        <button type="button" className="kiosk-tile orange" onClick={() => goTab('export')}>
          <span className="kiosk-sym">−</span><b>XUẤT KHO</b><small>Trừ tồn theo FIFO</small>
        </button>
        <button type="button" className="kiosk-tile" onClick={() => goTab('inventory')}>
          <span className="kiosk-sym green">▦</span><b>XEM KHO</b><small>{chemicals.length} hóa chất đang lưu kho</small>
        </button>
        <button type="button" className="kiosk-tile" onClick={() => searchRef.current?.focus()}>
          <span className="kiosk-sym"><span className="kiosk-magn" /></span><b>TÌM KIẾM</b><small>Tìm nhanh theo tên, NCC</small>
        </button>
        <button type="button" className="kiosk-tile" onClick={() => goTab('archive')}>
          <span className="kiosk-sym"><span className="kiosk-bars"><i style={{ height: 14 }} /><i style={{ height: 24 }} /><i style={{ height: 32 }} /></span></span><b>BÁO CÁO</b><small>Xuất PDF tồn kho tháng</small>
        </button>
        <button type="button" className="kiosk-tile" onClick={() => goTab('inventory')}>
          <span className="kiosk-sym red">!{alerts.length > 0 && <span className="kiosk-badge">{alerts.length}</span>}</span><b>CẢNH BÁO</b><small>{alerts.length ? `${alerts.length} mục cần chú ý ngay` : 'Kho đang ổn định'}</small>
        </button>
      </div>

      <div className="kiosk-stats">
        <div className="kiosk-total"><small>Tổng tồn kho</small><b>{totalStock.toLocaleString('vi-VN')} kg</b></div>
        <div className="kiosk-ticker-wrap in">
          <div className="kiosk-ticker-head"><b>↑ Nhập hôm nay</b><span>{totalIn.toLocaleString('vi-VN')} kg</span></div>
          <Ticker rows={importsToday} emptyText="Hôm nay chưa có nhập kho." duration={Math.max(6, importsToday.length * 3)} />
        </div>
        <div className="kiosk-ticker-wrap out">
          <div className="kiosk-ticker-head"><b>↓ Xuất hôm nay</b><span>{totalOut.toLocaleString('vi-VN')} kg</span></div>
          <Ticker rows={exportsToday} emptyText="Hôm nay chưa có xuất kho." duration={Math.max(6, exportsToday.length * 3) + 3} />
        </div>
      </div>

      {user.role === 'admin' && (
        <div className="kiosk-recent">
          <h4>Hoạt động gần đây</h4>
          {recent.length === 0 && <p className="kiosk-muted">Chưa có hoạt động nào.</p>}
          {recent.map((l) => (
            <div key={l.id} className="kiosk-recent-row">
              <span>{l.detail}</span>
              <small>{new Date(l.created_at).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} • {l.username}</small>
            </div>
          ))}
          {activities.length > 4 && <button type="button" className="kiosk-link" onClick={() => goTab('audit')}>Xem tất cả →</button>}
        </div>
      )}
    </div>
  );
}
  