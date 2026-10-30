import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';
import './Lots.css';

// So sánh không phân biệt dấu và hoa thường: gõ "hoa chat" vẫn khớp "Hóa chất"
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Hiển thị ngày kiểu Việt Nam: 2026-10-27 -> 27/10/2026
const fmtDate = (d) => {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
};

// Ô chọn có tìm kiếm: select mặc định của trình duyệt không có chỗ tìm kiếm nên tự làm.
// Bấm vào thì xổ ra khung tìm kiếm ở đầu danh sách, gõ là lọc ngay, Enter chọn dòng đầu, Esc đóng.
function SearchSelect({ options, value, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((o) => String(o.id) === String(value));
  const q = normalize(query);
  const filtered = q ? options.filter((o) => normalize(o.name).includes(q)) : options;

  const close = () => { setOpen(false); setQuery(''); };
  const pick = (id) => { onChange(String(id)); close(); };

  return (
    <div className="ss-wrap">
      <div
        className="ss-control"
        tabIndex={0}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? close() : setOpen(true); }
        }}
      >
        <span className={selected ? 'ss-value' : 'ss-placeholder'}>{selected ? selected.name : placeholder}</span>
        {selected && (
          <button type="button" className="ss-clear" title="Bỏ chọn" onClick={(e) => { e.stopPropagation(); onChange(''); }}>
            ×
          </button>
        )}
        <span className="ss-arrow">▾</span>
      </div>
      {open && (
        <div className="ss-list">
          <input
            autoFocus
            className="ss-search"
            placeholder="Tìm..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => setTimeout(close, 120)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'Enter' && filtered.length) pick(filtered[0].id);
            }}
          />
          <div className="ss-options">
            {filtered.length === 0 && <div className="ss-empty">Không tìm thấy</div>}
            {filtered.map((o) => (
              <div
                key={o.id}
                className={`ss-option${String(o.id) === String(value) ? ' selected' : ''}`}
                onMouseDown={(e) => { e.preventDefault(); pick(o.id); }}
              >
                {o.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Form nhập/sửa lot không còn mã lot (mã do hệ thống tự sinh)
const EMPTY_FORM = { chemical_id: '', supplier_id: '', quantity: '', unit: 'kg', purity: '', expiry_date: '', received_date: '' };

export default function Lots({ signal }) {
  const [lots, setLots] = useState([]);
  const [chemicals, setChemicals] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const [l, c, s] = await Promise.all([api.get('/lots'), api.get('/chemicals'), api.get('/suppliers')]);
      setLots(l.data); setChemicals(c.data); setSuppliers(s.data);
      return l.data;
    } catch (err) {
      console.error(err);
      return [];
    }
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Tab Mua/nhập chỉ hiện lot nhập tay; lot từ file Excel (source = 'excel') thì ẩn khỏi đây
  // (vẫn hiện ở tab Kho, QC và Truy xuất). Lot cũ chưa có source thì coi như nhập tay.
  const manualLots = lots.filter((l) => l.source !== 'excel');
  // Lọc theo tháng / theo ngày giống tab Xuất kho: chọn tháng thì chỉ hiện lot nhập trong tháng đó,
  // chọn ngày thì chỉ hiện đúng ngày đó (chọn ngày tự nhảy tháng về đúng tháng của ngày đó,
  // đổi tháng khác tháng của ngày đang chọn thì tự bỏ ngày). Lot không có ngày nhập thì không
  // gán được tháng/ngày nên khi đang lọc tháng/ngày sẽ tạm ẩn khỏi danh sách chi tiết.
  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return `Tháng ${Number(mo)}/${y}`;
  };
  const months = [...new Set(manualLots.map((l) => l.received_date ? String(l.received_date).slice(0, 10).slice(0, 7) : ''))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const q = normalize(search);
  const filtered = manualLots.filter((l) => {
    if (q && !(normalize(l.lot_code).includes(q) || normalize(l.chemical_name).includes(q) || normalize(l.supplier_name).includes(q))) return false;
    const d = l.received_date ? String(l.received_date).slice(0, 10) : '';
    if (monthFilter && d.slice(0, 7) !== monthFilter) return false;
    if (dayFilter && d !== dayFilter) return false;
    return true;
  });
  const filterActive = !!(monthFilter || dayFilter);
  const totalQty = filtered.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
  // Phân trang: mỗi trang 10 dòng
  const pageSize = 10;
  // Xếp từ cũ đến mới để món mới thêm luôn nằm cuối danh sách, STT tăng dần
  const sorted = [...filtered].sort((a, b) => a.id - b.id);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  const submit = async (e) => {
    e.preventDefault();
    // Ô chọn tự làm không dùng required của trình duyệt nên kiểm tra ở đây
    if (!form.chemical_id) { setMessage('Vui lòng chọn hóa chất'); return; }
    try {
      if (editingId) {
        await api.put(`/lots/${editingId}`, form);
        setMessage('Đã sửa lot');
        setEditingId(null);
        setForm(EMPTY_FORM);
        load();
      } else {
        await api.post('/lots', form);
        setForm(EMPTY_FORM);
        setMessage('Đã nhập kho');
        const data = await load();
        const manualCount = data.filter((l) => l.source !== 'excel').length;
        setPage(Math.max(1, Math.ceil(manualCount / pageSize))); // nhập xong nhảy tới trang cuối để thấy lot mới
      }
    } catch (err) {
      setMessage(err.response?.data?.message || (editingId ? 'Sửa lot thất bại' : 'Nhập kho thất bại'));
    }
  };

  // Bấm Sửa ở 1 dòng: đưa dữ liệu dòng đó lên form để sửa, bấm Lưu là xong
  // (mã lot do hệ thống tự sinh nên không sửa, form không còn ô mã lot)
  const startEdit = (l) => {
    setEditingId(l.id);
    setForm({
      chemical_id: l.chemical_id ? String(l.chemical_id) : '',
      supplier_id: l.supplier_id ? String(l.supplier_id) : '',
      quantity: l.quantity ?? '',
      unit: l.unit || 'kg',
      purity: l.purity ?? '',
      expiry_date: l.expiry_date ? String(l.expiry_date).slice(0, 10) : '',
      received_date: l.received_date ? String(l.received_date).slice(0, 10) : '',
    });
    setMessage('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  // Xóa 1 lot (kèm tồn kho, phiếu QC và lịch sử di chuyển của lot đó ở backend)
  const deleteOne = async (id) => {
    try {
      await api.delete(`/lots/${id}`);
      setMessage('Đã xóa lot');
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Xóa lot thất bại');
    }
  };

  return (
    <>
      <div className="tab-scroll">
      <h2>{editingId ? 'Sửa lot' : 'Nhập lot mới'}</h2>
      <form onSubmit={submit} className="form-row">
        <SearchSelect options={chemicals} value={form.chemical_id} onChange={(id) => setForm({ ...form, chemical_id: id })} placeholder="Chọn hóa chất" />
        <SearchSelect options={suppliers} value={form.supplier_id} onChange={(id) => setForm({ ...form, supplier_id: id })} placeholder="Chọn NCC" />
        <input placeholder="Số lượng" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} required />
        <input type="date" value={form.received_date} onChange={(e) => setForm({ ...form, received_date: e.target.value })} />
        <button type="submit">{editingId ? 'Lưu' : 'Nhập kho'}</button>
        {editingId && <button type="button" className="btn-secondary" onClick={cancelEdit}>Hủy</button>}
      </form>
      {message && <p>{message}</p>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input placeholder="Tìm theo mã lot, tên hóa chất hoặc NCC..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
        <select value={monthFilter} onChange={(e) => { const v = e.target.value; setMonthFilter(v); if (dayFilter && v && dayFilter.slice(0, 7) !== v) setDayFilter(''); setPage(1); }} style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} title="Lọc theo tháng">
          <option value="">Tất cả các tháng</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <input type="date" value={dayFilter} onChange={(e) => { const v = e.target.value; setDayFilter(v); if (v) setMonthFilter(v.slice(0, 7)); setPage(1); }} title="Lọc theo ngày" style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
        {filterActive && <button type="button" className="btn-secondary" onClick={() => { setMonthFilter(''); setDayFilter(''); setPage(1); }}>Xóa lọc</button>}
      </div>
      {filterActive && <p className="page-note">Đang lọc: {monthFilter ? monthLabel(monthFilter) : ''}{monthFilter && dayFilter ? ' — ' : ''}{dayFilter ? `ngày ${fmtDate(dayFilter)}` : ''} | Tổng: {filtered.length} lot, {totalQty} kg</p>}
      <table>
        <thead><tr><th>STT</th><th>Hóa chất</th><th>NCC</th><th>SL</th><th>Ngày nhập</th><th></th></tr></thead>
        <tbody>
          {pageItems.map((l, idx) => (
            <tr key={l.id}>
              <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{l.chemical_name}</td><td>{l.supplier_name}</td>
              <td>{Number(l.quantity)} {l.unit}</td><td>{fmtDate(l.received_date)}</td>
              <td><button onClick={() => startEdit(l)}>Sửa</button>{' '}<button onClick={() => setConfirm({ title: 'Xóa lot này?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa', action: () => deleteOne(l.id) })}>Xóa</button></td>
            </tr>
          ))}
          {pageItems.length === 0 && <tr><td colSpan={6}>{filterActive ? 'Không có lot nào khớp bộ lọc' : 'Chưa có lot nào'}</td></tr>}
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
