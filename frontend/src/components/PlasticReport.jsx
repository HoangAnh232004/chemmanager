import { useState, useEffect, useRef } from 'react';
import api from '../api';
import ConfirmModal from './ConfirmModal';
import PlasticDetail from './PlasticDetail';
import PlasticSummary from './PlasticSummary';
import PlasticMonthEnd from './PlasticMonthEnd';
import './PlasticReport.css';

// Mã nhựa đúng cột trong file Excel mẫu của user.
// Lưu ý: sample NL1 dùng 'SB-100' (có gạch nối), khác 'SB100' bên sản xuất.
const ITEMS = {
  NL1: {
    production: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670'],
    sample: ['640EW', 'BF-670', '655HIM-A', '655HIM-G', 'SB-100'],
  },
  NL2: {
    production: ['620L', 'RB-110', 'BF-670', 'BT-600'],
    sample: ['620L', 'RB-110', '640EW', 'BF-670', 'BT-600'],
  },
};
// Bảng tổng kết cuối tháng: 640C2P chỉ có ở bảng này/tuần, không có số liệu chi tiết.
const MONTH_END_ITEMS = {
  NL1: ['SB100', '640EW', '655HIM-G', '655HIM-A', 'BF-670', '640C2P'],
  NL2: ['620L', 'RB-110', 'BF-670', 'BT-600'],
};
const WEEKLY_ITEMS = {
  NL1: ['640EW', '655HIM-G', 'BF-670', '655HIM-A', '640C2P', 'SB-100'],
  NL2: ['620L', 'BF-670', 'BT-600', 'RB-110'],
};
const GROUPS = ['NL1', 'NL2'];

const fmt = (n) => (Number(n) || 0).toLocaleString('vi-VN', { maximumFractionDigits: 2 });
const fmtDay = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}/${y}`;
};
const fmtDateShort = (v) => {
  if (!v) return '—';
  if (v instanceof Date) return `${v.getDate()}/${v.getMonth() + 1}/${v.getFullYear()}`;
  const s = String(v).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s.split('-').reverse().join('/');
  return s;
};
// Mã sample tương ứng với mã tổng kết (chỉ SB100 khác tên: sample là SB-100)
const sampleItemOf = (item) => (item === 'SB100' ? 'SB-100' : item);

// Ô số nhập kiểu bảng tính: không controlled để gõ không giật, blur mới lưu
function NumCell({ value, disabled, onSave }) {
  return (
    <input
      type="number"
      step="any"
      className="pl-num"
      defaultValue={value || ''}
      key={String(value)}
      disabled={disabled}
      onBlur={(e) => {
        const raw = e.target.value;
        const n = raw === '' ? 0 : Number(raw);
        if (!Number.isNaN(n) && n !== (value || 0)) onSave(n);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
    />
  );
}

// Trang tường tổng hợp báo cáo nhựa: ghép 3 file riêng (chi tiết, tổng hợp
// ngày, tổng kết cuối tháng) với tồn theo bộ phận, xuất kho theo tuần và lưu trữ.
export default function PlasticReport({ signal, user }) {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [archived, setArchived] = useState([]);
  const [viewingArchive, setViewingArchive] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef(null);
  const isAdmin = user?.role === 'admin';

  const loadCurrent = async () => {
    try {
      const { data: d } = await api.get('/plastic/current');
      setData(d);
      setLoadError(false);
    } catch (err) {
      setLoadError(true);
    }
    try {
      const { data: p } = await api.get('/plastic/periods');
      setArchived(p || []);
    } catch (err) { /* kệ, chỉ mất danh sách lưu trữ */ }
    setViewingArchive(false);
  };

  useEffect(() => { loadCurrent(); }, [signal]);

  const loadPeriod = async (period) => {
    try {
      const { data: d } = await api.get(`/plastic/${period}`);
      setData(d);
      setViewingArchive(true);
    } catch (err) {
      alert('Không mở được tháng này');
    }
  };

  const period = data?.period || '';
  const closed = data?.status === 'closed';
  const [py, pm] = period ? period.split('-') : ['', ''];
  const daysInMonth = period ? new Date(Number(py), Number(pm), 0).getDate() : 0;
  const dayKey = (d) => `${period}-${String(d).padStart(2, '0')}`;

  // Map số liệu ngày: "YYYY-MM-DD|NL1|production|SB100" -> qty
  const dayMap = {};
  (data?.days || []).forEach((r) => {
    dayMap[`${String(r.day).slice(0, 10)}|${r.grp}|${r.kind}|${r.item}`] = Number(r.qty) || 0;
  });
  const cell = (day, grp, kind, item) => dayMap[`${day}|${grp}|${kind}|${item}`] || 0;
  const colSum = (grp, kind, item) => {
    let s = 0;
    for (let d = 1; d <= daysInMonth; d++) s += cell(dayKey(d), grp, kind, item);
    return s;
  };
  const dayProd = (day, grp) => ITEMS[grp].production.reduce((s, it) => s + cell(day, grp, 'production', it), 0);
  const daySample = (day, grp) => ITEMS[grp].sample.reduce((s, it) => s + cell(day, grp, 'sample', it), 0);
  const groupTotal = (grp) =>
    ITEMS[grp].production.reduce((s, it) => s + colSum(grp, 'production', it), 0) +
    ITEMS[grp].sample.reduce((s, it) => s + colSum(grp, 'sample', it), 0);
  const monthTotal = groupTotal('NL1') + groupTotal('NL2');

  // Tổng kết cuối tháng: NL/SAMPLE tự tính từ bảng chi tiết,
  // CÒN LẠI = STOCK OUT + TRẢ HÀNG - (NL + SAMPLE)
  const meMap = {};
  (data?.monthEnd || []).forEach((r) => { meMap[`${r.grp}|${r.item}`] = r; });
  const meRow = (grp, item) => {
    const nl = colSum(grp, 'production', item);
    const sample = colSum(grp, 'sample', sampleItemOf(item));
    const me = meMap[`${grp}|${item}`] || {};
    const stockOut = Number(me.stock_out) || 0;
    const ret = Number(me.return_qty) || 0;
    return { nl, sample, total: nl + sample, stockOut, ret, remain: stockOut + ret - (nl + sample) };
  };

  // Tồn theo bộ phận: SỬ DỤNG tự tính = tổng nhóm, CÒN LẠI = TỒN ĐẦU + NHẬP - SỬ DỤNG
  const stockMap = {};
  (data?.stock || []).forEach((r) => { stockMap[r.grp] = r; });
  const stockRow = (grp) => {
    const opening = Number(stockMap[grp]?.opening) || 0;
    const imp = Number(stockMap[grp]?.import_qty) || 0;
    const used = groupTotal(grp);
    return { opening, imp, used, remain: opening + imp - used };
  };

  // Xuất kho theo tuần
  const wkMap = {};
  (data?.weekly || []).forEach((r) => { wkMap[`${r.grp}|${r.item}|${r.week}`] = Number(r.qty) || 0; });
  const wkTotal = (grp, item) => [1, 2, 3, 4].reduce((s, w) => s + (wkMap[`${grp}|${item}|${w}`] || 0), 0);

  const saveDay = async (day, grp, kind, item, qty) => {
    try {
      await api.put('/plastic/day', { period, day, grp, kind, item, qty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveStock = async (grp, opening, importQty) => {
    try {
      await api.put('/plastic/stock', { period, grp, opening, import_qty: importQty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveWeekly = async (grp, item, week, qty) => {
    try {
      await api.put('/plastic/weekly', { period, week, grp, item, qty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const saveMonthEnd = async (grp, item, stockOut, returnQty) => {
    try {
      await api.put('/plastic/month-end', { period, grp, item, stock_out: stockOut, return_qty: returnQty });
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Lưu thất bại');
    }
  };
  const closeMonth = async () => {
    try {
      const { data: r } = await api.post('/plastic/close', { period });
      alert(r.message);
      setConfirmClose(false);
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Chốt tháng thất bại');
    }
  };
  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      const { data: r } = await api.post('/plastic/import', fd);
      alert(r.message);
      loadCurrent();
    } catch (err) {
      alert(err.response?.data?.message || 'Nhập file thất bại');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  };
  const exportCSV = () => {
    if (!data) return;
    const head = ['Ngày xuất'];
    GROUPS.forEach((g) => {
      ITEMS[g].production.forEach((it) => head.push(`SX ${g} ${it}`));
      head.push(`SX ${g} TOTAL`);
    });
    GROUPS.forEach((g) => {
      ITEMS[g].sample.forEach((it) => head.push(`Sample ${g} ${it}`));
      head.push(`Sample ${g} TOTAL`);
    });
    const lines = [head.join(',')];
    for (let d = 1; d <= daysInMonth; d++) {
      const day = dayKey(d);
      const row = [fmtDay(day)];
      GROUPS.forEach((g) => {
        ITEMS[g].production.forEach((it) => row.push(cell(day, g, 'production', it) || ''));
        row.push(dayProd(day, g) || '');
      });
      GROUPS.forEach((g) => {
        ITEMS[g].sample.forEach((it) => row.push(cell(day, g, 'sample', it) || ''));
        row.push(daySample(day, g) || '');
      });
      lines.push(row.join(','));
    }
    const totalRow = ['TOTAL'];
    GROUPS.forEach((g) => {
      ITEMS[g].production.forEach((it) => totalRow.push(colSum(g, 'production', it) || ''));
      totalRow.push(ITEMS[g].production.reduce((s, it) => s + colSum(g, 'production', it), 0) || '');
    });
    GROUPS.forEach((g) => {
      ITEMS[g].sample.forEach((it) => totalRow.push(colSum(g, 'sample', it) || ''));
      totalRow.push(ITEMS[g].sample.reduce((s, it) => s + colSum(g, 'sample', it), 0) || '');
    });
    lines.push(totalRow.join(','));
    lines.push(`NGUYÊN LIỆU 1 (Sản Xuất + Sample),${groupTotal('NL1')}`);
    lines.push(`NGUYÊN LIỆU 2 (Sản Xuất + Sample),${groupTotal('NL2')}`);
    lines.push(`TOTAL (NL1 + NL2),${monthTotal}`);
    const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bao-cao-nhua-${period}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (loadError) {
    return (
      <div className="tab-scroll">
        <h2>Báo cáo sử dụng nhựa</h2>
        <p>Chưa tải được dữ liệu. Kiểm tra backend đã có file <b>backend/routes/plastic.js</b> và đã gắn mount <b>/api/plastic</b> trong <b>server.js</b> rồi restart backend chưa.</p>
        <button onClick={loadCurrent}>Thử lại</button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="tab-scroll">
        <h2>Báo cáo sử dụng nhựa</h2>
        <p>Đang tải...</p>
      </div>
    );
  }

  return (
    <div className="tab-scroll">
      <h2>Báo cáo sử dụng nhựa</h2>
      <div className="pl-bar">
        <span className="pl-period">Kỳ: <b>{data.periodLabel}</b>{closed ? ' — Đã chốt' : ''}</span>
        {viewingArchive && <button onClick={loadCurrent}>← Quay lại tháng hiện tại</button>}
        <button onClick={exportCSV}>Xuất CSV</button>
        {isAdmin && !closed && (
          <label className="pl-file-btn">
            {importing ? 'Đang nhập...' : 'Nhập Excel'}
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden disabled={importing} onChange={importFile} />
          </label>
        )}
        {isAdmin && !closed && (
          <button className="btn-danger" onClick={() => setConfirmClose(true)}>Chốt tháng</button>
        )}
      </div>
      {closed && <p className="pl-locked">Tháng này đã chốt, chỉ xem không sửa được nữa.</p>}

      <PlasticDetail
        py={py} pm={pm} daysInMonth={daysInMonth} dayKey={dayKey} cell={cell}
        dayProd={dayProd} daySample={daySample} colSum={colSum}
        groupTotal={groupTotal} monthTotal={monthTotal}
        closed={closed} saveDay={saveDay} ITEMS={ITEMS} GROUPS={GROUPS}
      />
      <PlasticSummary
        py={py} pm={pm} daysInMonth={daysInMonth} dayKey={dayKey}
        dayProd={dayProd} daySample={daySample} colSum={colSum}
        groupTotal={groupTotal} ITEMS={ITEMS}
      />
      <PlasticMonthEnd
        MONTH_END_ITEMS={MONTH_END_ITEMS} meRow={meRow}
        closed={closed} saveMonthEnd={saveMonthEnd}
      />

      <section className="pl-section">
        <h3>Tồn theo bộ phận</h3>
        <table>
          <thead><tr><th>Bộ phận</th><th>Tồn đầu</th><th>Nhập</th><th>Sử dụng trong tháng</th><th>Còn lại</th></tr></thead>
          <tbody>
            {GROUPS.map((g) => {
              const s = stockRow(g);
              return (
                <tr key={g}>
                  <td>{g === 'NL1' ? 'NL1 + Sample' : 'NL2 + Sample'}</td>
                  <td><NumCell value={s.opening} disabled={closed} onSave={(n) => saveStock(g, n, s.imp)} /></td>
                  <td><NumCell value={s.imp} disabled={closed} onSave={(n) => saveStock(g, s.opening, n)} /></td>
                  <td>{fmt(s.used)}</td>
                  <td>{fmt(s.remain)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="pl-section">
        <h3>Số lượng kho nguyên liệu xuất trong tháng (theo tuần)</h3>
        <table>
          <thead><tr><th>Nhóm</th><th>Item</th><th>Tuần 1</th><th>Tuần 2</th><th>Tuần 3</th><th>Tuần 4</th><th>TOTAL</th></tr></thead>
          <tbody>
            {GROUPS.map((g) => WEEKLY_ITEMS[g].map((it) => (
              <tr key={`${g}-${it}`}>
                <td>{g === 'NL1' ? 'Nguyên liệu 1' : 'Nguyên liệu 2'}</td>
                <td>{it}</td>
                {[1, 2, 3, 4].map((w) => (
                  <td key={w}>
                    <NumCell value={wkMap[`${g}|${it}|${w}`] || 0} disabled={closed}
                      onSave={(n) => saveWeekly(g, it, w, n)} />
                  </td>
                ))}
                <td className="pl-total">{fmt(wkTotal(g, it))}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </section>

      <section className="pl-section">
        <h3>Lưu trữ báo cáo sử dụng nhựa</h3>
        {archived.length === 0 ? (
          <p>Chưa có tháng nào được chốt.</p>
        ) : (
          <table>
            <thead><tr><th>Kỳ</th><th>Tổng sử dụng</th><th>Ngày chốt</th><th></th></tr></thead>
            <tbody>
              {archived.map((a) => (
                <tr key={a.period}>
                  <td>{`Tháng ${Number(a.period.split('-')[1])}/${a.period.split('-')[0]}`}</td>
                  <td>{fmt(a.total)} kg</td>
                  <td>{fmtDateShort(a.closed_at)}</td>
                  <td><button onClick={() => loadPeriod(a.period)}>Xem</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <ConfirmModal
        open={confirmClose}
        title="Chốt tháng này?"
        message={`Tháng ${data.periodLabel} sẽ chuyển vào Lưu trữ báo cáo sử dụng nhựa và không sửa được nữa. Tháng mới sẽ mở ra trống để nhập tiếp.`}
        confirmText="Chốt tháng"
        onConfirm={closeMonth}
        onCancel={() => setConfirmClose(false)}
      />
    </div>
  );
}
