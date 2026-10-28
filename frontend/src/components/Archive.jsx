import { useState, useEffect } from 'react';
import api from '../api';
import Pagination from './Pagination';
import { exportMonthlyPDF } from './monthlyPdf';

const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/g, 'd');

// Trạng thái chỉ so Tồn với Tối thiểu (áp cho số tồn cuối đã chốt của tháng):
// tồn = 0 → Hết hàng; tồn vượt tối thiểu không quá 20% → Đặt hàng; hơn 20% → Đủ hàng
function withStatus(r) {
  const minStock = Number(r.min_stock) || 0;
  const orderQty = Number(r.order_qty) || 0;
  const closing = Number(r.closing) || 0;
  const status = closing <= 0 ? 'Hết hàng' : (closing <= minStock * 1.2 ? 'Đặt hàng' : 'Đủ hàng');
  const statusClass = { 'Hết hàng': 'st-out', 'Đặt hàng': 'st-warn' }[status] || '';
  return { ...r, minStock, maxStock: orderQty, closing, status, statusClass };
}

// Lưu trữ kho theo tháng: chỉ xem lại các tháng đã chốt (số liệu đóng băng, không sửa được)
export default function Archive({ signal }) {
  const [periods, setPeriods] = useState([]);
  const [selected, setSelected] = useState('');
  const [periodLabel, setPeriodLabel] = useState('');
  const [rows, setRows] = useState([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api.get('/monthly/periods').then(({ data }) => {
      const closed = (data || []).filter((p) => p.status === 'closed');
      setPeriods(closed);
      if (closed.length && !selected) setSelected(closed[0].period);
    }).catch(console.error);
  }, [signal]);

  useEffect(() => {
    if (!selected) return;
    api.get(`/monthly/${selected}`).then(({ data }) => {
      setPeriodLabel(data.periodLabel); setRows(data.rows || []); setPage(1);
    }).catch(console.error);
  }, [selected]);

  const enriched = rows.map(withStatus);

  const q = normalize(search);
  const filtered = enriched.filter((r) => normalize(r.chemical_name).includes(q) || normalize(r.korean_name).includes(q));

  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = filtered.slice((safePage - 1) * pageSize, safePage * pageSize);

  const exportPDF = async () => {
    setExporting(true);
    try {
      await exportMonthlyPDF({
        title: 'Danh sách tồn kho',
        subtitle: `Kỳ: ${periodLabel} (đã chốt) | Ngày xuất: ${new Date().toLocaleDateString('vi-VN')} | Tổng số: ${filtered.length} hóa chất${search ? ` | Từ khóa: ${search}` : ''}`,
        rows: filtered,
        filename: `ton-kho-${selected}.pdf`,
      });
    } catch (err) {
      console.error(err);
      alert('Xuất PDF thất bại');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <div className="tab-scroll">
      <h2>Lưu trữ kho theo tháng</h2>
      <p className="page-note">Các tháng đã chốt, số liệu không sửa được. Chọn tháng để xem lại file kho tháng đó.</p>
      {periods.length === 0 ? (
        <p className="page-note">Chưa có tháng nào được lưu trữ. Hết tháng, file tháng cũ sẽ tự chuyển vào đây.</p>
      ) : (
        <>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>
            {periods.map((p) => <option key={p.period} value={p.period}>{p.periodLabel}</option>)}
          </select>
          <input placeholder="Tìm theo tên hóa chất..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="search-box" />
          <button onClick={exportPDF} disabled={exporting}>{exporting ? 'Đang tạo...' : 'Xuất PDF'}</button>
        </div>
        <table>
          <thead><tr><th>STT</th><th>Tên hóa chất</th><th>Tên Hàn</th><th>NCC</th><th>Hạn dùng</th><th>Quy cách</th><th>Tồn đầu kỳ</th><th>Tối thiểu</th><th>Tối đa</th><th>Nhập</th><th>Xuất</th><th>Tồn</th><th>Trạng thái</th></tr></thead>
          <tbody>
            {pageItems.map((r, idx) => (
              <tr key={r.chemical_name}>
                <td>{(safePage - 1) * pageSize + idx + 1}</td><td>{r.chemical_name}</td><td>{r.korean_name || '—'}</td><td>{r.supplier_name || '—'}</td>
                <td>{r.expiry ? r.expiry.slice(0, 10) : '—'}</td><td>{r.packaging || '—'}</td><td>{r.opening_stock}</td><td>{r.minStock ? r.minStock : '—'}</td><td>{r.maxStock ? r.maxStock : '—'}</td>
                <td>{r.stock_in}</td><td>{r.stock_out}</td><td>{r.closing}</td><td className={r.statusClass}>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}
      </div>
      <div className="pagination-bar">
        <Pagination page={safePage} totalPages={totalPages} onChange={setPage} />
      </div>
    </>
  );
}
