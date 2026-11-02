import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import ConfirmModal from './ConfirmModal';
import DayWall from './DayWall';
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
  const [dayFilter, setDayFilter] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [periods, setPeriods] = useState([]);

  const load = async () => {
    try {
      const [l, c, s, p] = await Promise.all([api.get('/lots'), api.get('/chemicals'), api.get('/suppliers'), api.get('/monthly/periods').catch(() => ({ data: [] }))]);
      setLots(l.data); setChemicals(c.data); setSuppliers(s.data);
      setPeriods(p.data || []);
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
  // Tường tháng = kỳ đang mở ở Kho (chốt tháng xong thì tường nhảy sang tháng tiếp theo);
  // chưa có kỳ mở thì lấy tháng dương lịch hiện tại
  const now = new Date();
  const calendarMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const wallMonth = (periods.find((p) => p.status === 'open') || {}).period || calendarMonth;
  // Tháng đã chốt thì sang tab Lưu trữ xuất nhập, không hiện ở bảng chính nữa
  const closedMonths = new Set(periods.filter((p) => p.status === 'closed').map((p) => p.period));
  const activeLots = manualLots.filter((l) => !closedMonths.has(l.received_date ? String(l.received_date).slice(0, 10).slice(0, 7) : ''));
  // Nhập ngày nào rơi vào ô ngày đó trên tường
  const wallEntries = {};
  activeLots.forEach((l) => {
    const d = l.received_date ? String(l.received_date).slice(0, 10) : '';
    if (!d || d.slice(0, 7) !== wallMonth) return;
    (wallEntries[d] = wallEntries[d] || []).push({ label: l.chemical_name, qty: Number(l.quantity) || 0 });
  });
  // Bấm ô ngày có nhập thì hiện bảng nổi của ngày đó; ô trống thì không chọn
  const pickWallDay = (d) => {
    if (!d) { setDayFilter(''); return; }
    const has = activeLots.some((l) => l.received_date && String(l.received_date).slice(0, 10) === d);
    setDayFilter(has ? d : '');
  };
  // Lọc theo tháng / theo ngày giống tab Xuất kho: chọn tháng thì chỉ hiện lot nhập trong tháng đó,
  // chọn ngày thì chỉ hiện đúng ngày đó (chọn ngày tự nhảy tháng về đúng tháng của ngày đó,
  // đổi tháng khác tháng của ngày đang chọn thì tự bỏ ngày). Lot không có ngày nhập thì không
  // gán được tháng/ngày nên khi đang lọc tháng/ngày sẽ tạm ẩn khỏi danh sách chi tiết.
  // Du lieu cua ngay dang bam tren tuong, de hien bang noi
  const dayRows = dayFilter ? activeLots.filter((l) => l.received_date && String(l.received_date).slice(0, 10) === dayFilter).sort((x, y) => x.id - y.id) : [];
  const dayTotal = dayRows.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

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
        load();
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

  const askDelete = (l) => setConfirm({ title: 'Xóa lot này?', message: 'Hành động này không khôi phục được.', confirmText: 'Xóa', action: () => deleteOne(l.id) });

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
      <DayWall month={wallMonth} entries={wallEntries} selectedDay={dayFilter} onSelectDay={pickWallDay} />
      {dayFilter && dayRows.length > 0 && (
        <div onClick={() => setDayFilter('')} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', overflowY: 'auto', zIndex: 1000, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ margin: 'auto', background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 640, maxHeight: 'calc(100vh - 32px)', overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>Nhập kho ngày {fmtDate(dayFilter)} ({dayRows.length} lot, {dayTotal} kg)</h3>
              <button type="button" onClick={() => setDayFilter('')}>Đóng</button>
            </div>
            <table>
              <thead><tr><th>STT</th><th>Hóa chất</th><th>NCC</th><th>SL</th><th>Thao tác</th></tr></thead>
              <tbody>
                {dayRows.map((l, idx) => (
                  <tr key={l.id}>
                    <td>{idx + 1}</td><td>{l.chemical_name}</td><td>{l.supplier_name}</td>
                    <td>{Number(l.quantity)} {l.unit}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><button onClick={() => { startEdit(l); setDayFilter(''); }}>Sửa</button><button onClick={() => { setDayFilter(''); askDelete(l); }}>Xóa</button></span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        confirmText={confirm?.confirmText}
        onConfirm={() => { confirm.action(); setConfirm(null); }}
        onCancel={() => setConfirm(null)}
      />
      </div>
    </>
  );
}
