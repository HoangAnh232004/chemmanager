import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';
import './Lots.css';

// So sánh không phân biệt dấu và hoa thường (giống ô chọn ở form nhập lot)
const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Hiển thị ngày kiểu 27/10/2026 (giống bảng Mua/nhập)
const fmtDate = (d) => {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
};

// Ô chọn có tìm kiếm: bấm vào thì xổ ra khung tìm kiếm ở đầu danh sách, gõ là lọc ngay,
// Enter chọn dòng đầu, Esc đóng, nút × bỏ chọn.
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

export default function Export({ signal }) {
  const [chemicals, setChemicals] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [exports, setExports] = useState([]);
  const [chemicalId, setChemicalId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [exportDate, setExportDate] = useState('');
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = async () => {
    try {
      const [c, i, e] = await Promise.all([api.get('/chemicals'), api.get('/inventory'), api.get('/lots/exports')]);
      setChemicals(c.data); setInventory(i.data); setExports(e.data);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    load();
  }, [signal]);

  // Tồn hiện tại của hóa chất đang chọn (API tồn kho đã trả kèm tên hóa chất).
  // Xuất trừ vào tồn thực tế gồm cả lot Excel, vì tab Kho tính cả lot Excel.
  const selected = chemicals.find((c) => String(c.id) === String(chemicalId));
  const currentStock = chemicalId
    ? inventory.filter((i) => i.chemical_name === selected?.name).reduce((sum, i) => sum + (Number(i.quantity_available) || 0), 0)
    : 0;
  const qtyNum = Number(quantity);
  // Đang sửa mà không đổi hóa chất thì số lượng cũ sẽ được hoàn lại trước nên tồn cho phép = tồn hiện tại + số cũ
  const effectiveStock = editing && selected?.name === editing.chemical ? currentStock + Number(editing.quantity) : currentStock;
  const overStock = chemicalId && qtyNum > 0 && qtyNum > effectiveStock;

  // Sửa: đưa dữ liệu dòng đó lên form phía trên, tiêu đề đổi thành "Sửa...", nút thành "Lưu", có nút "Hủy"
  const startEdit = (row) => {
    const chem = chemicals.find((c) => c.name === row.chemical_name);
    setChemicalId(chem ? String(chem.id) : '');
    setQuantity(String(Number(row.quantity)));
    setExportDate(String(row.export_date).slice(0, 10));
    setNote(row.note || '');
    setEditing({ date: String(row.export_date).slice(0, 10), chemical: row.chemical_name, note: row.note, quantity: row.quantity });
    setMessage('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setChemicalId('');
    setQuantity('');
    setNote('');
    setExportDate('');
  };

  const deleteOne = async (row) => {
    try {
      const res = await api.delete('/lots/exports', { data: { date: String(row.export_date).slice(0, 10), chemical: row.chemical_name, note: row.note, quantity: Number(row.quantity) } });
      setMessage(res.data.message);
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || 'Xóa lần xuất thất bại');
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!chemicalId) { setMessage('Vui lòng chọn hóa chất'); return; }
    try {
      if (editing) {
        const payload = { oldDate: editing.date, oldChemical: editing.chemical, oldNote: editing.note, chemical_id: chemicalId, chemical: selected?.name || '', quantity: qtyNum, note };
        if (exportDate) payload.export_date = exportDate;
        const res = await api.put('/lots/exports', payload);
        setMessage(res.data.message);
        cancelEdit();
        load();
        return;
      }
      const payload = { chemical_id: chemicalId, quantity: qtyNum, note };
      // Ô ngày để trống thì không gửi, backend tính lần xuất đó là ngày thực tế xuất (hôm nay)
      if (exportDate) payload.export_date = exportDate;
      const res = await api.post('/lots/export', payload);
      setMessage(res.data.message);
      setQuantity('');
      setNote('');
      setExportDate('');
      load();
    } catch (err) {
      setMessage(err.response?.data?.message || (editing ? 'Sửa lần xuất thất bại' : 'Xuất kho thất bại'));
    }
  };

  // Danh sách xuất: backend đã xếp mới nhất lên đầu; tìm theo tên hóa chất
  // (gõ là lọc ngay, không phân biệt dấu/hoa thường), lọc trước rồi mới phân trang, gõ tìm là về trang 1.
  // Lọc theo tháng / theo ngày để dễ kiểm soát: chọn tháng thì chỉ hiện lần xuất trong tháng đó,
  // chọn ngày thì chỉ hiện đúng ngày đó (chọn ngày tự nhảy tháng về đúng tháng của ngày đó,
  // đổi tháng khác tháng của ngày đang chọn thì tự bỏ ngày).
  const monthLabel = (m) => {
    const [y, mo] = m.split('-');
    return `Tháng ${Number(mo)}/${y}`;
  };
  const months = [...new Set(exports.map((x) => String(x.export_date).slice(0, 10).slice(0, 7)))].filter((m) => /^\d{4}-\d{2}$/.test(m)).sort().reverse();
  const q = normalize(search);
  const filtered = exports.filter((x) => {
    if (q && !normalize(x.chemical_name).includes(q)) return false;
    const d = String(x.export_date).slice(0, 10);
    if (monthFilter && d.slice(0, 7) !== monthFilter) return false;
    if (dayFilter && d !== dayFilter) return false;
    return true;
  });
  const filterActive = !!(monthFilter || dayFilter);
  const totalQty = filtered.reduce((sum, x) => sum + (Number(x.quantity) || 0), 0);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  return (
    <>
      <div className="tab-scroll">
      <h2>{editing ? 'Sửa lần xuất' : 'Xuất kho'}</h2>
      <form onSubmit={submit} className="form-row">
        <SearchSelect options={chemicals} value={chemicalId} onChange={setChemicalId} placeholder="Chọn hóa chất" />
        <input placeholder="Số lượng xuất (kg)" type="number" min="0" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        <input type="date" lang="en-US" value={exportDate} onChange={(e) => setExportDate(e.target.value)} title="Ngày xuất" />
        <input placeholder="Ghi chú (không bắt buộc)" value={note} onChange={(e) => setNote(e.target.value)} />
        <button type="submit">{editing ? 'Lưu' : 'Xuất kho'}</button>
        {editing && <button type="button" className="btn-secondary" onClick={cancelEdit}>Hủy</button>}
      </form>
      {chemicalId && <p>Tồn hiện tại: {currentStock} kg</p>}
      {overStock && <p className="msg-error">Số lượng xuất vượt quá tồn kho!</p>}
      {message && <p>{message}</p>}

      <h3>Danh sách xuất kho</h3>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input placeholder="Tìm hóa chất..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
        <select value={monthFilter} onChange={(e) => { const v = e.target.value; setMonthFilter(v); if (dayFilter && v && dayFilter.slice(0, 7) !== v) setDayFilter(''); setPage(1); }} style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} title="Lọc theo tháng">
          <option value="">Tất cả các tháng</option>
          {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
        </select>
        <input type="date" value={dayFilter} onChange={(e) => { const v = e.target.value; setDayFilter(v); if (v) setMonthFilter(v.slice(0, 7)); setPage(1); }} title="Lọc theo ngày" style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8 }} />
        {filterActive && <button type="button" className="btn-secondary" onClick={() => { setMonthFilter(''); setDayFilter(''); setPage(1); }}>Xóa lọc</button>}
      </div>
      {filterActive && <p className="page-note">Đang lọc: {monthFilter ? monthLabel(monthFilter) : ''}{monthFilter && dayFilter ? ' — ' : ''}{dayFilter ? `ngày ${fmtDate(dayFilter)}` : ''} | Tổng: {filtered.length} lần xuất, {totalQty} kg</p>}
      <table>
        <thead>
          <tr><th>Ngày xuất</th><th>Hóa chất</th><th>Số lượng (kg)</th><th>Ghi chú</th><th>Thao tác</th></tr>
        </thead>
        <tbody>
          {pageItems.map((x) => (
            <tr key={`${x.export_date}-${x.chemical_name}-${x.note}`}>
              <td>{fmtDate(x.export_date)}</td><td>{x.chemical_name}</td><td>{Number(x.quantity)}</td><td>{x.note}</td>
              <td><button onClick={() => startEdit(x)}>Sửa</button>{' '}<button onClick={() => setConfirm({ title: 'Xóa lần xuất này?', message: `Xóa lần xuất ${Number(x.quantity)} kg ${x.chemical_name} ngày ${fmtDate(x.export_date)}? Số lượng sẽ được hoàn lại vào kho.`, confirmText: 'Xóa', action: () => deleteOne(x) })}>Xóa</button></td>
            </tr>
          ))}
          {pageItems.length === 0 && <tr><td colSpan={5}>{filterActive ? 'Không có lần xuất nào khớp bộ lọc' : 'Chưa có lần xuất nào'}</td></tr>}
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
