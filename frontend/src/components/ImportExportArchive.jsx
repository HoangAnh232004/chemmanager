import { useState, useEffect } from 'react';
import api from '../api';
import DayWall from './DayWall';

// Lưu trữ xuất nhập: các tháng đã chốt ở Kho (chỉ xem, không sửa).
// Chốt tháng nào thì nhập/xuất tháng đó sang đây, xem theo tường ngày của tháng đó.

const normalize = (s) => (s || '').toString().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');

const fmtDate = (d) => {
  if (!d) return '';
  const s = String(d).slice(0, 10);
  const p = s.split('-');
  return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : s;
};

const monthLabel = (m) => {
  const [y, mo] = m.split('-');
  return `Tháng ${Number(mo)}/${y}`;
};

export default function ImportExportArchive({ signal }) {
  const [periods, setPeriods] = useState([]);
  const [selected, setSelected] = useState('');
  const [lots, setLots] = useState([]);
  const [exports, setExports] = useState([]);
  const [search, setSearch] = useState('');
  const [importDay, setImportDay] = useState('');
  const [exportDay, setExportDay] = useState('');

  useEffect(() => {
    api.get('/monthly/periods').then(({ data }) => {
      const closed = (data || []).filter((p) => p.status === 'closed');
      setPeriods(closed);
      if (closed.length && !selected) setSelected(closed[0].period);
    }).catch(console.error);
  }, [signal]);

  useEffect(() => {
    Promise.all([
      api.get('/lots').catch(() => ({ data: [] })),
      api.get('/lots/exports').catch(() => ({ data: [] })),
    ]).then(([l, e]) => { setLots(l.data || []); setExports(e.data || []); }).catch(console.error);
  }, [signal]);

  const q = normalize(search);
  const monthLots = lots.filter((l) => l.source !== 'excel' && l.received_date && String(l.received_date).slice(0, 10).slice(0, 7) === selected && (!q || normalize(l.chemical_name).includes(q)));
  const monthExports = exports.filter((x) => String(x.export_date).slice(0, 10).slice(0, 7) === selected && (!q || normalize(x.chemical_name).includes(q)));
  const wallEntriesOf = (rows, dateOf) => {
    const map = {};
    rows.forEach((r) => {
      const d = dateOf(r);
      if (!d) return;
      (map[d] = map[d] || []).push({ label: r.chemical_name, qty: Number(r.quantity) || 0 });
    });
    return map;
  };
  const importWall = wallEntriesOf(monthLots, (l) => String(l.received_date).slice(0, 10));
  const exportWall = wallEntriesOf(monthExports, (x) => String(x.export_date).slice(0, 10));
  const importDetail = importDay ? monthLots.filter((l) => String(l.received_date).slice(0, 10) === importDay) : [];
  const exportDetail = exportDay ? monthExports.filter((x) => String(x.export_date).slice(0, 10) === exportDay) : [];
  const importDayTotal = importDetail.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const exportDayTotal = exportDetail.reduce((s, x) => s + (Number(x.quantity) || 0), 0);
  // Chỉ ô ngày có dữ liệu mới chọn để hiện bảng nổi; ô trống bấm không chọn
  const pickImportDay = (d) => setImportDay(d && importWall[d]?.length ? d : '');
  const pickExportDay = (d) => setExportDay(d && exportWall[d]?.length ? d : '');
  const importTotal = monthLots.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const exportTotal = monthExports.reduce((s, x) => s + (Number(x.quantity) || 0), 0);

  return (
    <div className="tab-scroll">
      <h2>Lưu trữ xuất nhập</h2>
      {periods.length === 0 ? (
        <p>Chưa có tháng nào được chốt.</p>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <select value={selected} onChange={(e) => { setSelected(e.target.value); setImportDay(''); setExportDay(''); }} style={{ padding: '7px 10px', border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }} title="Chọn tháng đã chốt">
              {periods.map((p) => <option key={p.period} value={p.period}>{monthLabel(p.period)}</option>)}
            </select>
            <input placeholder="Tìm hóa chất..." value={search} onChange={(e) => setSearch(e.target.value)} className="search-box" />
          </div>

          <h3>Nhập kho</h3>
          <DayWall month={selected} entries={importWall} selectedDay={importDay} onSelectDay={pickImportDay} showTitle={false} />
          {importDay && importDetail.length > 0 && (
            <div onClick={() => setImportDay('')} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 640, maxHeight: '80vh', overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Nhập kho ngày {fmtDate(importDay)} ({importDetail.length} lot, {importDayTotal} kg)</h3>
                  <button type="button" onClick={() => setImportDay('')}>Đóng</button>
                </div>
                <table>
                  <thead><tr><th>Hóa chất</th><th>NCC</th><th>SL</th></tr></thead>
                  <tbody>
                    {importDetail.map((l) => (
                      <tr key={l.id}>
                        <td>{l.chemical_name}</td><td>{l.supplier_name}</td><td>{Number(l.quantity)} {l.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="page-note">Tổng: {monthLots.length} lot | {importTotal} kg</p>

          <h3>Xuất kho</h3>
          <DayWall month={selected} entries={exportWall} selectedDay={exportDay} onSelectDay={pickExportDay} showTitle={false} />
          {exportDay && exportDetail.length > 0 && (
            <div onClick={() => setExportDay('')} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
              <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 16, padding: 20, width: '100%', maxWidth: 640, maxHeight: '80vh', overflow: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <h3 style={{ margin: 0 }}>Xuất kho ngày {fmtDate(exportDay)} ({exportDetail.length} lần, {exportDayTotal} kg)</h3>
                  <button type="button" onClick={() => setExportDay('')}>Đóng</button>
                </div>
                <table>
                  <thead><tr><th>Hóa chất</th><th>Số lượng (kg)</th><th>Ghi chú</th></tr></thead>
                  <tbody>
                    {exportDetail.map((x) => (
                      <tr key={`${x.export_date}-${x.chemical_name}-${x.note}`}>
                        <td>{x.chemical_name}</td><td>{Number(x.quantity)}</td><td>{x.note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="page-note">Tổng: {monthExports.length} lần xuất | {exportTotal} kg</p>
        </>
      )}
    </div>
  );
}
