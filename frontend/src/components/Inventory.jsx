import { useState, useEffect, useRef } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';
import { exportMonthlyPDF } from './monthlyPdf';
import './Inventory.css';

// So sánh không phân biệt dấu và hoa thường: gõ "hoa chat" vẫn khớp "Hóa chất"
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Trạng thái chỉ so Tồn với Tối thiểu: tồn = 0 → Hết hàng;
// tồn vượt tối thiểu không quá 20% (kể cả tồn dưới tối thiểu) → Đặt hàng;
// tồn vượt tối thiểu hơn 20% → Đủ hàng (cột Tối đa không còn quyết định trạng thái)
function withStatus(r) {
  const minStock = Number(r.min_stock) || 0;
  const orderQty = Number(r.order_qty) || 0;
  const closing = Number(r.closing) || 0;
  const status = closing <= 0 ? 'Hết hàng' : (closing <= minStock * 1.2 ? 'Đặt hàng' : 'Đủ hàng');
  const statusClass = { 'Hết hàng': 'st-out', 'Đặt hàng': 'st-warn' }[status] || '';
  return { ...r, minStock, maxStock: orderQty, closing, status, statusClass };
}

export default function Inventory({ signal, user, highlightChemical, onHighlightDone }) {
  const [period, setPeriod] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [now, setNow] = useState(new Date());
  const [loaded, setLoaded] = useState(false);
  const [flashName, setFlashName] = useState(null);
  const rowRefs = useRef({});

  // Đồng hồ ngày: cập nhật mỗi giây
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/monthly/current');
      setPeriod(data.period); setPeriodLabel(data.periodLabel); setRows(data.rows || []);
    } catch (err) {
      console.error(err);
    }
    setLoaded(true);
  };

  useEffect(() => {
    load();
  }, [signal]);

  const enriched = rows.map(withStatus);

  // Tìm kiếm theo tên hóa chất hoặc tên Hàn (gõ là lọc ngay, không phân biệt dấu)
  const q = normalize(search);
  const filtered = enriched.filter((r) => normalize(r.chemical_name).includes(q) || normalize(r.korean_name).includes(q));

  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  // Nhảy tới đúng hóa chất từ bảng nổi thông báo: bỏ lọc tìm kiếm, nhảy tới
  // đúng trang chứa nó rồi nháy vàng 1 lần; không thấy thì dọn highlight luôn
  useEffect(() => {
    if (!highlightChemical || !loaded) return;
    const target = enriched.find((r) => r.chemical_name === highlightChemical)
      || enriched.find((r) => normalize(r.chemical_name) === normalize(highlightChemical));
    if (!target) { onHighlightDone?.(); return; }
    const idx = enriched.indexOf(target);
    setSearch('');
    setPage(Math.floor(idx / pageSize) + 1);
    setFlashName(target.chemical_name);
  }, [highlightChemical, loaded]);

  // Cuộn tới dòng đang nháy (sau khi đã nhảy đúng trang)
  useEffect(() => {
    if (!flashName) return;
    const el = rowRefs.current[flashName];
    if (!el) { setFlashName(null); onHighlightDone?.(); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [flashName, safePage]);

  const handleFlashEnd = () => { setFlashName(null); onHighlightDone?.(); };

  const deleteAll = async () => {
    try {
      await api.delete('/import/inventory');
      setPage(1);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Xóa thất bại');
    }
  };

  const closeMonth = async () => {
    try {
      const { data } = await api.post('/monthly/close');
      alert(data.message);
      setPage(1);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Chốt tháng thất bại');
    }
  };

  // Lưu ghi chú đặt hàng của từng hóa chất: chọn "Đã đặt" khi đã đặt hàng
  // bên ngoài, chọn "—" để xóa ghi chú; lưu xong tải lại bảng
  const saveNote = async (r, value) => {
    try {
      await api.put(`/lots/chemical-note/${r.chemical_id}`, { order_note: value });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu ghi chú thất bại');
    }
  };

  const exportPDF = async () => {
    setExporting(true);
    try {
      await exportMonthlyPDF({
        title: 'Danh sách tồn kho',
        subtitle: `Kỳ: ${periodLabel} | Ngày xuất: ${new Date().toLocaleDateString('vi-VN')} | Tổng số: ${filtered.length} hóa chất${search ? ` | Từ khóa: ${search}` : ''}`,
        rows: filtered,
        filename: `ton-kho-${period}.pdf`,
      });
    } catch (err) {
      console.error(err);
      alert('Xuất PDF thất bại');
    } finally {
      setExporting(false);
    }
  };

  const clockText = now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeText = now.toLocaleTimeString('vi-VN');

  return (
    <>
      <div className="tab-scroll">
      <h2>Tồn kho</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <span style={{ background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 8, padding: '6px 12px', fontSize: 14 }}>
          {clockText} — {timeText} | Kỳ: <b>{periodLabel}</b>
        </span>
        {user?.role === 'admin' && (
          <button onClick={() => setConfirm({ title: 'Chốt tháng này?', message: `Tháng ${periodLabel} sẽ được lưu vào tab Lưu trữ và không sửa được nữa. Tháng mới sẽ mở ra với tồn đầu kỳ = tồn cuối tháng này, Nhập/Xuất về 0.`, confirmText: 'Chốt tháng', action: closeMonth })}>Chốt tháng</button>
        )}
        {user?.role === 'admin' && (
          <button onClick={() => setConfirm({ title: 'Xóa TẤT CẢ kho?', message: 'Toàn bộ lot, tồn kho, phiếu QC và lịch sử di chuyển sẽ bị xóa hết. Hành động này không khôi phục được.', confirmText: 'Xóa tất cả', action: deleteAll })} className="btn-danger">
            Xóa tất cả
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <input placeholder="Tìm theo tên hóa chất..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
        <button onClick={exportPDF} disabled={exporting}>{exporting ? 'Đang tạo...' : 'Xuất PDF'}</button>
      </div>
      <table>
        <thead><tr><th>STT</th><th>Tên hóa chất</th><th>Tên Hàn</th><th>NCC</th><th>Hạn dùng</th><th>Quy cách</th><th>Tồn đầu kỳ</th><th>Tối thiểu</th><th>Tối đa</th><th>Nhập</th><th>Xuất</th><th>Tồn</th><th>Trạng thái</th><th>Ghi chú</th></tr></thead>
        <tbody>
          {pageItems.map((r, idx) => (
            <tr key={r.chemical_name}
              ref={(el) => { if (el) rowRefs.current[r.chemical_name] = el; }}
              className={flashName === r.chemical_name ? 'inv-flash' : undefined}
              onAnimationEnd={flashName === r.chemical_name ? handleFlashEnd : undefined}
            >
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{r.chemical_name}</td><td>{r.korean_name || '—'}</td><td>{r.supplier_name || '—'}</td>
              <td>{r.expiry ? r.expiry.slice(0, 10) : '—'}</td><td>{r.packaging || '—'}</td><td>{r.opening_stock}</td><td>{r.minStock ? r.minStock : '—'}</td><td>{r.maxStock ? r.maxStock : '—'}</td>
              <td>{r.stock_in}</td><td>{r.stock_out}</td><td>{r.closing}</td><td className={r.statusClass}>{r.status}</td>
              <td>
                <select
                  className={`note-select${r.order_note ? ' has-note' : ''}`}
                  value={r.order_note || ''}
                  disabled={!r.chemical_id}
                  title={r.chemical_id ? 'Chọn khi đã đặt hàng bên ngoài' : 'Hóa chất chưa có trong danh mục nên không lưu được ghi chú'}
                  onChange={(e) => saveNote(r, e.target.value)}
                >
                  <option value="">—</option>
                  <option value="Đã đặt">Đã đặt</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        onConfirm={() => { confirm.action(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
      </div>
      <div className="pagination-bar">
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
